# Builds the soundscape files for the walks: audio/amb/*.mp3 (looping backgrounds) and audio/music/*.mp3.
#
#   python3 -m venv .venv && .venv/bin/pip install numpy scipy soundfile lameenc
#   .venv/bin/python tools/sound/make-sounds.py
#
# Sources (downloaded into tools/sound/cache/, see README "Звуки"):
#   recordings from Blanket (github.com/rafaelmardojai/blanket, SOUNDS_LICENSING.md):
#     birds (kvgarlic, CC0), stream (gluckose, CC0), wind (felix.blume, CC0),
#     coffee-shop (stephan / SoundBible, public domain), fireplace (ezwa / SoundBible, public domain)
#   instrument samples: FluidR3_GM by Frank Wen, rendered by gleitz/midi-js-soundfonts, CC BY 3.0
#   everything else (horses and carriages, bells, fountain, clock, hammering, tram bell, applause) is synthesised here.
# The music is our own rendering of public-domain scores: Mozart KV 265 (theme) and KV 525 (opening),
# Beethoven WoO 59 "Für Elise" (opening) and the "Ode to Joy" theme from the Ninth Symphony.
import os, io, urllib.request
import numpy as np, soundfile as sf, lameenc
from scipy import signal

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..")
CACHE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "cache")
AMB = os.path.join(ROOT, "audio", "amb"); MUS = os.path.join(ROOT, "audio", "music")
for d in (CACHE, AMB, MUS): os.makedirs(d, exist_ok=True)
SR = 44100
rng = np.random.default_rng(1786)

BLANKET = "https://raw.githubusercontent.com/rafaelmardojai/blanket/master/data/resources/sounds/{}.ogg"
FLUID = "https://raw.githubusercontent.com/gleitz/midi-js-soundfonts/gh-pages/FluidR3_GM/{}-mp3/{}.mp3"

def fetch(url, name):
    p = os.path.join(CACHE, name)
    if not os.path.exists(p):
        with urllib.request.urlopen(url, timeout=60) as r: data = r.read()
        open(p, "wb").write(data)
    return p

def load(path):
    x, sr = sf.read(path, always_2d=True, dtype="float32")
    x = x.mean(1)
    if sr != SR: x = signal.resample_poly(x, SR, sr).astype(np.float32)
    return x

# ---------- helpers ----------
def sos(kind, f, order=4): return signal.butter(order, f, btype=kind, fs=SR, output="sos")
def filt(x, kind, f, order=4): return signal.sosfilt(sos(kind, f, order), x).astype(np.float32)
def rms_db(x): return 20*np.log10(np.sqrt(np.mean(x**2)) + 1e-12)
def level(x, db):
    x = x * 10**((db - rms_db(x))/20)
    pk = np.abs(x).max()
    if pk > 0.89: x = np.tanh(x / 0.89) * 0.89       # gentle safety limiter
    return x.astype(np.float32)

def reverb(x, t60=1.6, wet=0.25, pre=0.012):
    n = int(SR*t60); t = np.arange(n)/SR
    ir = rng.standard_normal(n) * np.exp(-6.9*t/t60)
    ir = filt(ir, "lowpass", 5000, 2); ir[:int(pre*SR)] = 0; ir /= np.sqrt((ir**2).sum())
    y = signal.fftconvolve(x, ir)[:len(x)]
    return ((1-wet)*x + wet*y*0.7).astype(np.float32)

def loopify(x, seconds, xf=2.5):
    """Seamless loop: the tail after `seconds` is cross-faded into the head (equal power)."""
    L, F = int(seconds*SR), int(xf*SR)
    assert len(x) >= L + F, (len(x)/SR, seconds)
    y = x[:L].copy(); t = np.linspace(0, np.pi/2, F)
    y[:F] = y[:F]*np.sin(t) + x[L:L+F]*np.cos(t)
    return y

def texture(src, seconds, seg=(3.5, 6.0), xf=0.8):
    """A longer, less repetitive bed cut from a short recording: random segments joined with cross-fades."""
    out = np.zeros(int((seconds+8)*SR), np.float32); pos = 0; F = int(xf*SR); w = np.sin(np.linspace(0, np.pi/2, F))
    while pos < len(out):
        n = int(rng.uniform(*seg)*SR); s = int(rng.uniform(0, len(src)-n-1))
        piece = src[s:s+n].copy(); piece[:F] *= w; piece[-F:] *= w[::-1]
        end = min(len(out), pos+n); out[pos:end] += piece[:end-pos]; pos += n - F
    return out

def encode(x, path, kbps=64):
    x = np.clip(x, -1, 1); pcm = (x*32767).astype(np.int16)
    e = lameenc.Encoder(); e.set_bit_rate(kbps); e.set_in_sample_rate(SR); e.set_channels(1); e.set_quality(2)
    open(path, "wb").write(e.encode(pcm.tobytes()) + e.flush())
    print(f"{os.path.relpath(path, ROOT):32s} {len(x)/SR:5.1f}s {rms_db(x):6.1f} dB {os.path.getsize(path)//1024:4d} KB")

def env_smooth(n, rate, lo=0.3, hi=1.0):
    """Slow random envelope (gusts, crowd swells)."""
    k = max(2, int(n/SR*rate)+2); pts = rng.uniform(lo, hi, k)
    return np.interp(np.arange(n), np.linspace(0, n, k), pts).astype(np.float32)

def damped(freq, tau, n, phase=0.0):
    t = np.arange(n)/SR
    return (np.sin(2*np.pi*freq*t + phase) * np.exp(-t/tau)).astype(np.float32)

def add(buf, x, at):
    i = int(at*SR)
    if i < 0: x = x[-i:]; i = 0
    if i >= len(buf) or not len(x): return
    j = min(len(buf), i+len(x)); buf[i:j] += x[:j-i]

# ---------- recordings ----------
def rec_beds():
    birds = load(fetch(BLANKET.format("birds"), "birds.ogg"))
    encode(level(loopify(birds[int(5*SR):], 60, 3), -27), os.path.join(AMB, "birds.mp3"), 64)
    stream = load(fetch(BLANKET.format("stream"), "stream.ogg"))
    encode(level(loopify(stream[int(10*SR):], 50, 3), -27), os.path.join(AMB, "stream.mp3"), 64)
    cafe = load(fetch(BLANKET.format("coffee-shop"), "coffee-shop.ogg"))
    encode(level(loopify(texture(cafe, 50), 45, 2), -27), os.path.join(AMB, "cafe.mp3"), 56)
    # crowd murmur outdoors: the café chatter, darker and farther away
    mur = reverb(filt(texture(cafe, 50, (4, 7)), "lowpass", 1600, 4), 1.2, 0.35)
    encode(level(loopify(mur, 45, 2), -30), os.path.join(AMB, "murmur.mp3"), 48)
    fire = load(fetch(BLANKET.format("fireplace"), "fireplace.ogg"))
    encode(level(loopify(texture(fire, 45, (4, 7)), 40, 2), -32), os.path.join(AMB, "fireplace.mp3"), 56)
    # leaves: recorded wind plus a synthetic rustle of foliage in the gusts
    wind = load(fetch(BLANKET.format("wind"), "wind.ogg"))
    w = texture(wind, 50, (4, 7), 1.2); n = len(w)
    gust = env_smooth(n, 0.35, 0.15, 1.0)**2
    rustle = filt(rng.standard_normal(n).astype(np.float32), "bandpass", [1800, 9000], 2)
    crackle = np.zeros(n, np.float32); idx = rng.integers(0, n, int(n/SR*900)); crackle[idx] = rng.standard_normal(len(idx))
    crackle = filt(crackle, "bandpass", [2500, 10000], 2)
    leaves = rustle*gust*0.5 + crackle*gust*1.4
    mix = level(w, -34) + level(leaves, -31)
    encode(level(loopify(mix, 45, 2.5), -29), os.path.join(AMB, "leaves.mp3"), 64)

# ---------- synthesised ----------
def hoof(bright=1.0):
    n = int(0.09*SR); x = np.zeros(n, np.float32)
    for f, tau, a in [(rng.uniform(650, 950), 0.018, 1.0), (rng.uniform(1300, 1800), 0.010, 0.7),
                      (rng.uniform(2300, 3200), 0.006, 0.5*bright), (rng.uniform(250, 350), 0.025, 0.5)]:
        x += a*damped(f, tau, n, rng.uniform(0, 6.28))
    click = rng.standard_normal(n).astype(np.float32) * np.exp(-np.arange(n)/SR/0.0015)
    x += 0.8*filt(click, "highpass", 2000, 2)
    return x * rng.uniform(0.6, 1.0)

def carriage_pass(dur, center, speed=3.6, d0=5.0, horses=2, trot=True):
    """One carriage passing: trotting horses on cobbles and iron-rimmed wheels, louder and brighter as it passes."""
    n = int(dur*SR); near = np.zeros(n, np.float32)
    for h in range(horses):
        T = rng.uniform(0.33, 0.37) if trot else rng.uniform(0.27, 0.31); t = rng.uniform(0, T)
        while t < dur:
            if trot:
                add(near, hoof(), t); add(near, hoof()*0.8, t + rng.uniform(0.012, 0.03)); t += T*rng.uniform(0.97, 1.03)
            else:
                add(near, hoof(), t); t += T*rng.uniform(0.9, 1.1)
    # wheels: rumble with a bump on every cobble, plus a faint rattle
    rumble = filt(np.cumsum(rng.standard_normal(n)).astype(np.float32), "bandpass", [40, 380], 2); rumble /= np.abs(rumble).max()+1e-9
    bumps = np.zeros(n, np.float32); t = 0
    while t < dur:
        add(bumps, damped(rng.uniform(90, 160), 0.03, int(0.12*SR)) * rng.uniform(0.3, 1.0), t); t += rng.uniform(0.05, 0.11)
    rattle = filt(rng.standard_normal(n).astype(np.float32), "bandpass", [1500, 3500], 2) * env_smooth(n, 8, 0.2, 1.0)
    wheels = rumble*0.35 + bumps*0.45 + rattle*0.04
    x = near*0.9 + wheels
    t = np.arange(n)/SR; d = np.sqrt(d0**2 + (speed*(t-center))**2)
    g = (d0/d)**1.1
    far = filt(x, "lowpass", 900, 2)
    k = np.clip((d-d0)/40, 0, 1)
    return (x*(1-k) + far*k) * g

def carriage_bed():
    dur = 58; buf = np.zeros(int(dur*SR), np.float32)
    buf += carriage_pass(dur, 14, 3.8, 6, 2, True)
    buf += carriage_pass(dur, 38, 1.6, 9, 1, False) * 0.8
    buf += carriage_pass(dur, 53, 3.4, 12, 2, True) * 0.6
    buf = reverb(buf, 1.0, 0.18)
    encode(level(loopify(buf, 55, 3), -29), os.path.join(AMB, "carriage.mp3"), 56)

BELL = [(0.5, 1.0, 1.0), (1.0, 0.7, 0.55), (1.183, 0.55, 0.45), (1.506, 0.3, 0.35), (2.0, 0.65, 0.3),
        (2.51, 0.28, 0.2), (2.66, 0.22, 0.18), (3.01, 0.22, 0.15), (4.0, 0.1, 0.1), (5.04, 0.05, 0.07)]
def bell(prime, T, amp=1.0, dur=None):
    """A church bell: inharmonic partials (hum, prime, minor-third tierce, quint, nominal...) with long decays and beating."""
    dur = dur or T*1.2; n = int(dur*SR); t = np.arange(n)/SR; x = np.zeros(n, np.float32)
    for r, a, dk in BELL:
        f = prime*r
        if f > 9000: continue
        beat = rng.uniform(0.15, 0.6)
        x += (a * np.exp(-t/(T*dk)) * (np.sin(2*np.pi*f*t) + 0.6*np.sin(2*np.pi*(f+beat)*t + 1.3))).astype(np.float32)
    strike = filt(rng.standard_normal(int(0.03*SR)).astype(np.float32), "bandpass", [prime*2, min(prime*12, 12000)], 2)
    x[:len(strike)] += strike * np.exp(-np.arange(len(strike))/SR/0.006) * 1.5
    x[:int(0.002*SR)] *= np.linspace(0, 1, int(0.002*SR))
    return x*amp

def bells_city():
    """A peal of four swinging bells, heard across the rooftops."""
    dur = 62; buf = np.zeros(int(dur*SR), np.float32)
    for prime, period, amp in [(196, 2.3, 1.0), (247, 2.05, 0.8), (294, 1.85, 0.7), (392, 1.6, 0.55)]:
        t = rng.uniform(0, period)
        while t < dur:
            add(buf, bell(prime, 5.5, amp*rng.uniform(0.85, 1.0), 7), t); t += period*rng.uniform(0.97, 1.03)
    buf = reverb(filt(buf, "lowpass", 4500, 2), 2.6, 0.35)
    encode(level(loopify(buf, 58, 3), -29), os.path.join(AMB, "bells.mp3"), 56)

def bell_village():
    dur = 50; buf = np.zeros(int(dur*SR), np.float32); t = 0.3
    while t < dur:
        add(buf, bell(698, 2.2, rng.uniform(0.75, 1.0), 3), t); t += 1.25*rng.uniform(0.98, 1.02)
    buf = reverb(filt(buf, "lowpass", 5000, 2), 1.8, 0.3)
    encode(level(loopify(buf, 46, 2.5), -31), os.path.join(AMB, "bell-village.mp3"), 56)

def bell_toll():
    dur = 58; buf = np.zeros(int(dur*SR), np.float32); t = 0.5
    while t < dur:
        add(buf, bell(131, 9, 1.0, 12), t); t += 6.5
    buf = reverb(filt(buf, "lowpass", 3500, 2), 3.0, 0.35)
    encode(level(loopify(buf, 52, 4), -30), os.path.join(AMB, "bell-toll.mp3"), 56)

def fountain():
    """Splashing water: thousands of tiny bubbles (Minnaert resonances) over a hiss of falling water."""
    dur = 50; n = int(dur*SR); buf = np.zeros(n, np.float32)
    for _ in range(int(dur*260)):
        f0 = np.exp(rng.uniform(np.log(500), np.log(3200))); tau = rng.uniform(0.004, 0.02); m = int(tau*6*SR)
        tt = np.arange(m)/SR; f = f0*(1 + 0.3*tt/(tau*6))
        b = np.sin(2*np.pi*np.cumsum(f)/SR) * np.exp(-tt/tau) * rng.pareto(2.5)*0.15
        add(buf, b.astype(np.float32), rng.uniform(0, dur))
    hiss = filt(rng.standard_normal(n).astype(np.float32), "bandpass", [900, 7000], 2) * env_smooth(n, 3, 0.6, 1.0) * 0.08
    buf = reverb(buf + hiss, 0.9, 0.2)
    encode(level(loopify(buf, 46, 2.5), -30), os.path.join(AMB, "fountain.mp3"), 64)

def clock():
    """A pendulum clock beating seconds in a quiet room."""
    dur = 30; n = int(dur*SR); buf = np.zeros(n, np.float32)
    for k in range(dur):
        f1, f2 = (2900, 5200) if k % 2 == 0 else (2500, 4600)
        m = int(0.06*SR)
        tick = damped(f1, 0.004, m) + 0.5*damped(f2, 0.0025, m) + 0.6*damped(620, 0.012, m)
        add(buf, tick*0.9, k + rng.uniform(-0.003, 0.003))
    room = filt(np.cumsum(rng.standard_normal(n)).astype(np.float32), "lowpass", 300, 2); room *= 0.02/np.abs(room).max()
    buf = reverb(buf, 0.5, 0.25) + room
    encode(level(buf, -33), os.path.join(AMB, "clock.mp3"), 48)

def hammering():
    """A building site in the distance: bursts of hammer blows on wood."""
    dur = 55; buf = np.zeros(int(dur*SR), np.float32); t = 1.0
    while t < dur:
        for _ in range(rng.integers(4, 10)):
            m = int(0.2*SR)
            blow = damped(rng.uniform(380, 520), 0.03, m) + 0.6*damped(rng.uniform(900, 1300), 0.012, m) + 0.25*damped(rng.uniform(2600, 3400), 0.05, m)
            add(buf, blow*rng.uniform(0.6, 1.0), t); t += rng.uniform(0.35, 0.55)
        t += rng.uniform(3, 8)
    buf = reverb(filt(buf, "lowpass", 3000, 2), 1.4, 0.4)
    encode(level(loopify(buf, 50, 3), -32), os.path.join(AMB, "hammer.mp3"), 48)

def tram():
    """1900s street: now and then the double ding of an electric tram and its rumble along the rails."""
    dur = 62; n = int(dur*SR); buf = np.zeros(n, np.float32)
    for at in (9, 36):
        for k in range(2):
            ding = bell(1180, 1.1, 0.6, 1.6); add(buf, ding, at + k*0.28)
        rumble = filt(rng.standard_normal(int(14*SR)).astype(np.float32), "bandpass", [60, 500], 2)
        rumble *= np.hanning(len(rumble)).astype(np.float32) * 0.5
        clack = np.zeros(len(rumble), np.float32)
        for c in np.arange(0.5, 13.5, 0.62): add(clack, damped(700, 0.01, 1500)*0.5 + damped(220, 0.02, 1500)*0.3, c)
        add(buf, (rumble + clack*np.hanning(len(clack))).astype(np.float32), at + 0.5)
    buf = reverb(filt(buf, "lowpass", 4000, 2), 1.2, 0.3)
    encode(level(loopify(buf, 58, 3), -31), os.path.join(AMB, "tram.mp3"), 48)

def applause():
    """Applause of a full house, with the hall's reverb: rises, holds and dies away."""
    dur = 20; n = int(dur*SR); buf = np.zeros(n, np.float32)
    for _ in range(170):
        start = rng.uniform(0, 2.2); stop = rng.uniform(11, 17); rate = rng.uniform(3.4, 5.6)
        fc = rng.uniform(900, 2600); gain = rng.uniform(0.3, 1.0) * (1 if rng.random() > 0.3 else 0.5)
        cl = filt(rng.standard_normal(int(0.03*SR)).astype(np.float32), "bandpass", [fc*0.6, fc*1.6], 2)
        cl *= np.exp(-np.arange(len(cl))/SR/0.005)
        t = start
        while t < stop:
            add(buf, cl*gain*rng.uniform(0.7, 1.0), t); t += (1/rate)*rng.uniform(0.9, 1.1)
    buf = reverb(buf, 2.0, 0.35)
    fade = np.ones(n, np.float32); a = int(15*SR); fade[a:] = np.linspace(1, 0, n-a)**1.5
    encode(level(buf*fade, -24), os.path.join(MUS, "applause.mp3"), 80)

# ---------- music from FluidR3 samples ----------
NAMES = ["C","Db","D","Eb","E","F","Gb","G","Ab","A","Bb","B"]
def note_name(m): return f"{NAMES[m%12]}{m//12-1}"
_samples = {}
def sample(inst, m):
    k = (inst, m)
    if k not in _samples:
        p = fetch(FLUID.format(inst, note_name(m)), f"{inst}-{note_name(m)}.mp3")
        x = load(p); i = np.argmax(np.abs(x) > 0.01); _samples[k] = x[max(0, i-50):]
    return _samples[k]
def N(s):  # "F#4" -> midi
    name, octv = s[:-1], int(s[-1]); base = {"C":0,"D":2,"E":4,"F":5,"G":7,"A":9,"B":11}[name[0]]
    return 12*(octv+1) + base + name.count("#") - name.count("b")

def render(events, bpm, tail=2.5, rev=(1.8, 0.22)):
    """events: (beat, beats, note, velocity, instrument)"""
    spb = 60/bpm; end = max(b+d for b, d, *_ in events)*spb + tail
    buf = np.zeros(int(end*SR), np.float32)
    for b, d, note, vel, inst in events:
        x = sample(inst, N(note) if isinstance(note, str) else note)
        hold = d*spb + (0.9 if inst == "acoustic_grand_piano" else 0.12)
        rel = 0.25 if inst == "acoustic_grand_piano" else 0.35
        m = min(len(x), int((hold+rel)*SR)); y = x[:m].copy()
        r = int(rel*SR)
        if m > r: y[-r:] *= np.linspace(1, 0, r)
        add(buf, y*vel, b*spb)
    return reverb(buf, *rev)

def seq(notes, start=0.0, vel=0.8, inst="acoustic_grand_piano"):
    """notes: list of (note or None, beats)"""
    ev, t = [], start
    for n, d in notes:
        if n: ev.append((t, d, n, vel, inst))
        t += d
    return ev

def k265():
    """Mozart, variations on "Ah, vous dirai-je, maman" KV 265: the theme."""
    A = [("C5",1),("C5",1),("G5",1),("G5",1),("A5",1),("A5",1),("G5",2),("F5",1),("F5",1),("E5",1),("E5",1),("D5",1),("D5",1),("C5",2)]
    B = [("G5",1),("G5",1),("F5",1),("F5",1),("E5",1),("E5",1),("D5",2)]*2
    mel = A + B + A
    bassA = [("C3",2),("E3",2),("F3",2),("E3",2),("D3",2),("C3",2),("F3",1),("G3",1),("C3",2)]
    bassB = [("E3",2),("D3",2),("C3",2),("G2",2)]*2
    ev = seq(mel, 0, 0.75) + seq(bassA + bassB + bassA, 0, 0.55)
    encode(level(render(ev, 104), -21), os.path.join(MUS, "k265.mp3"), 80)

def k525():
    """Mozart, Eine kleine Nachtmusik KV 525: the opening bars, strings in octaves."""
    ph = [("G4",1),(None,.5),("D4",.5),("G4",1),(None,.5),("D4",.5),
          ("G4",.5),("D4",.5),("G4",.5),("B4",.5),("D5",2),
          ("C5",1),(None,.5),("A4",.5),("C5",1),(None,.5),("A4",.5),
          ("C5",.5),("A4",.5),("F#4",.5),("A4",.5),("D4",2)]
    ev = []
    for rep in range(2):
        base = rep*16
        for sh, v in ((0, .8), (-12, .6), (-24, .5)):
            for b, d, n, vel, inst in seq(ph, base, v, "string_ensemble_1"):
                ev.append((b, d, N(n)+sh, vel, inst))
    for n in ("G2","D3","B3","G4"): ev.append((32, 3, N(n), .7, "string_ensemble_1"))
    encode(level(render(ev, 128, 2.5, (1.6, 0.2)), -21), os.path.join(MUS, "k525.mp3"), 80)

def elise():
    """Beethoven, "Für Elise" WoO 59: the opening phrase, twice."""
    s = .5  # a sixteenth in beats of an eighth note
    rh = [("E5",s),("D#5",s)]
    phrase_a = [("E5",s),("D#5",s),("E5",s),("B4",s),("D5",s),("C5",s)]
    ev = []; t = 0
    def bar(notes_rh, lh=None):
        nonlocal t
        ev.extend(seq(notes_rh, t, .7));
        if lh: ev.extend(seq(lh, t, .5))
        t += 3
    for rep in range(2):
        ev.extend(seq(rh, t, .7)); t += 1
        bar(phrase_a)
        bar([("A4",1),(None,s),("C4",s),("E4",s),("A4",s)], [("A2",s),("E3",s),("A3",s)])
        bar([("B4",1),(None,s),("E4",s),("G#4",s),("B4",s)], [("E2",s),("E3",s),("G#3",s)])
        bar([("C5",1),(None,s),("E4",s),("E5",s),("D#5",s)], [("A2",s),("E3",s),("A3",s)])
        bar(phrase_a)
        bar([("A4",1),(None,s),("C4",s),("E4",s),("A4",s)], [("A2",s),("E3",s),("A3",s)])
        bar([("B4",1),(None,s),("E4",s),("C5",s),("B4",s)], [("E2",s),("E3",s),("G#3",s)])
        bar([("A4",2)], [("A2",s),("E3",s),("A3",1.5)])
    encode(level(render(ev, 150, 3), -21), os.path.join(MUS, "elise.mp3"), 80)

def ode():
    """Beethoven, Symphony No. 9: the "Ode to Joy" theme, strings with sustained chords."""
    q = 1
    mel = [("F#4",q),("F#4",q),("G4",q),("A4",q),("A4",q),("G4",q),("F#4",q),("E4",q),("D4",q),("D4",q),("E4",q),("F#4",q),("F#4",1.5),("E4",.5),("E4",2),
           ("F#4",q),("F#4",q),("G4",q),("A4",q),("A4",q),("G4",q),("F#4",q),("E4",q),("D4",q),("D4",q),("E4",q),("F#4",q),("E4",1.5),("D4",.5),("D4",2),
           ("E4",q),("E4",q),("F#4",q),("D4",q),("E4",q),("F#4",.5),("G4",.5),("F#4",q),("D4",q),("E4",q),("F#4",.5),("G4",.5),("F#4",q),("E4",q),("D4",q),("E4",q),("A3",2),
           ("F#4",q),("F#4",q),("G4",q),("A4",q),("A4",q),("G4",q),("F#4",q),("E4",q),("D4",q),("D4",q),("E4",q),("F#4",q),("E4",1.5),("D4",.5),("D4",2)]
    ev = [(b, d, N(n)+12, v, i) for b, d, n, v, i in seq(mel, 0, .8, "string_ensemble_1")]
    ev += seq(mel, 0, .45, "acoustic_grand_piano")
    chords = ["D","A","D","A","D","A","D","A-D","A","A-D","A-D","D-A","D","A","D","A-D"]
    triad = {"D":["D3","A3","F#4"], "A":["A2","E3","C#4"]}
    for k, c in enumerate(chords):
        parts = c.split("-")
        for j, p in enumerate(parts):
            dur = 4/len(parts)
            for n in triad[p]: ev.append((k*4 + j*dur, dur, N(n)-12 if n.endswith("4") else N(n), .32, "string_ensemble_1"))
    encode(level(render(ev, 104, 3, (2.0, 0.25)), -21), os.path.join(MUS, "ode.mp3"), 80)

if __name__ == "__main__":
    import sys; only = sys.argv[1:]
    jobs = [rec_beds, carriage_bed, bells_city, bell_village, bell_toll, fountain, clock, hammering, tram, applause, k265, k525, elise, ode]
    for job in jobs:
        if not only or job.__name__ in only: job()
