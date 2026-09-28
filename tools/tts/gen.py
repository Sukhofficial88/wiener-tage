import json, re, sys, os, time, numpy as np, lameenc
from kokoro_onnx import Kokoro
OUT = sys.argv[1]; os.makedirs(OUT, exist_ok=True)
k = Kokoro('expo/package/build/kokoro-quantized.onnx', 'voices.npz')
# Один голос рассказчика для всех маршрутов: герои не говорят от первого лица
VOICES = {  # голос, скорость, акцент
  "narrator":  ("bf_emma",   0.97, "en-gb"),
}
FIX = {  # правильное произношение имён (IPA)
  "Heiligenstadt":"hˈaɪlɪɡənʃtˌat", "Ries":"ɹˈiːs", "Flöge":"flˈɜːɡə", "Wiener":"vˈiːnə", "Werkstätte":"vˈɛəkʃtˌɛtə",
  "Kunstschau":"kˈʊnstʃaʊ", "Sühnhaus":"zˈuːnhaʊs", "Ringtheater":"ɹˈɪŋteɪˌɑːtə", "Burgtheater":"bˈʊəkteɪˌɑːtə",
  "Landtmann":"lˈantman", "Constanze":"kɒnstˈantsə", "Attersee":"ˈatəzeɪ", "Graben":"ɡɹˈɑːbən", "Therese":"teɪɹˈeɪzə",
  "Emilie":"eɪmˈiːliə", "Loos":"lˈəʊs", "Mehlgrube":"mˈeɪlɡɹuːbə", "Wegeler":"vˈeɪɡələ", "Mathilde":"matˈɪldə",
  "Herr":"hˈeə", "Figaro":"fˈɪɡəɹəʊ", "più":"pjˈuː", "andrai":"andɹˈaɪ", "grande":"ɡɹˈandeɪ", "Domgasse":"dˈəʊmɡasə",
  "Berggasse":"bˈɛəkɡasə", "Schönbrunn":"ʃˈɜːnbɹʊn", "Trattner":"tɹˈatnə",
  "Kohlmarkt":"kˈəʊlmɑːkt", "Schreiberbach":"ʃɹˈaɪbəbax", "Probusgasse":"pɹˈəʊbʊsɡasə", "Ringstrasse":"ɹˈɪŋʃtɹɑːsə",
  "Privatdozent":"pɹɪvˈɑːtdəʊtsˌɛnt", "Konzerthaus":"kɒntsˈɛəthaʊs", "Kapellmeister":"kapˈɛlmaɪstə", "Schiele":"ʃˈiːlə",
  "Michaelerplatz":"mˈɪçaɛləplats", "Grüner":"ɡɹˈuːnə", "Schwestern":"ʃvˈɛstən", "tarock":"tɑːɹˈɒk", "Olbrich":"ˈɒlbɹɪç"
}
ONES="zero one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen".split()
TENS="_ _ twenty thirty forty fifty sixty seventy eighty ninety".split()
def two(n):
    if n<20: return ONES[n]
    return TENS[n//10]+("" if n%10==0 else "-"+ONES[n%10])
def year(m):
    y=int(m.group(0)); a,b=divmod(y,100)
    return two(a)+" "+("hundred" if b==0 else ("oh "+ONES[b] if b<10 else two(b)))
def prep(text):
    text = text.replace("“",'"').replace("”",'"').replace("‘","'").replace("’","'").replace("–","-")
    text = re.sub(r"\b(1[6-9]\d\d)\b", year, text)
    text = re.sub(r"\b6th\b","sixth",text)
    return text
def phonemes(text, lang):
    ph = k.tokenizer.phonemize(prep(text), lang)
    for w, ipa in FIX.items():
        if w not in text: continue
        src = k.tokenizer.phonemize(w, lang).strip()
        for variant in {src, src.replace("ˈ","ˌ",1)}:
            ph = ph.replace(variant, ipa)
    return ph
def encode(samples, sr, path):
    rms = float(np.sqrt(np.mean(samples**2))) or 1e-6
    samples = samples * min(0.085/rms, 0.95/float(np.max(np.abs(samples))))
    pcm = (np.clip(samples,-1,1)*32767).astype(np.int16)
    enc = lameenc.Encoder(); enc.set_bit_rate(64); enc.set_in_sample_rate(sr); enc.set_channels(1); enc.set_quality(2)
    open(path,"wb").write(enc.encode(pcm.tobytes())+enc.flush())
def say(text, who, path):
    v, sp, lang = VOICES[who]
    s, sr = k.create(phonemes(text, lang), voice=v, speed=sp, lang=lang, is_phonemes=True)
    encode(s, sr, path); return len(s)/sr
texts = json.load(open("en-texts.json"))
only = sys.argv[2:] or list(texts)
total=0; t0=time.time()
# тишина для разблокировки звука на iPhone
encode(np.zeros(int(24000*0.3),dtype=np.float32)+1e-6, 24000, os.path.join(OUT,"..","silence.mp3"))
for hero in only:
    d = texts[hero]
    total += say(d["intro"], "narrator", f"{OUT}/{hero}-intro.mp3")
    for i, txt in enumerate(d["stops"], 1):
        dur = say(txt, "narrator", f"{OUT}/{hero}-{i}.mp3"); total += dur
        print(f"{hero}-{i}: {dur:.1f}s (elapsed {time.time()-t0:.0f}s)", flush=True)
    total += say(d["epilogue"], "narrator", f"{OUT}/{hero}-epilogue.mp3")
print(f"DONE {total/60:.1f} min of audio in {(time.time()-t0)/60:.1f} min", flush=True)
