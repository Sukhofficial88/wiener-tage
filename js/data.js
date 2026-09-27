// Общие данные «Венских дней»: маршруты, координаты, геозоны. Тексты на каждом языке лежат в js/content/<язык>.js.
// Координаты: Wien Geschichte Wiki, Apple Maps и Wikipedia; точки с approx:true поставлены
// по описанию улиц и уточняются на месте через режим уточнения координат в настройках.
// radius — радиус геозоны в метрах: в нём голос героя включается сам. transit:true — к точке удобнее ехать.
// Чтобы подключить запись актёра, добавьте к остановке audio:{ru:"audio/ru/mozart-1.mp3", de:"…"}.

export const HEROES = [
{
  id:"mozart", mono:"WAM", sphere:"music", years:"1756–1791", vienna:[[1781, 1791]], dayYear:1786,
  voice:{rate:1.07,pitch:1.12},
  stops:[
    {time:"07:00", stay:10, snd:{bed:[["birds",0.7],["bells",0.35]],music:"k265"}, addr:"Domgasse 5, 1010 Wien", lat:48.20819, lng:16.37485, radius:40},
    {time:"09:00", stay:15, snd:{bed:[["bells",0.9],["murmur",0.5],["carriage",0.4]]}, addr:"Stephansplatz 3, 1010 Wien", lat:48.20861, lng:16.37306, radius:80},
    {time:"11:00", stay:10, snd:{bed:[["fountain",0.8],["murmur",0.5],["carriage",0.5]]}, addr:"Neuer Markt 5, 1010 Wien", lat:48.20625, lng:16.37080, radius:55, approx:true},
    {time:"13:00", stay:10, snd:{bed:[["murmur",0.6],["fountain",0.4],["carriage",0.5]],music:"k525"}, addr:"Graben 29, 1010 Wien", lat:48.20900, lng:16.37050, radius:55, approx:true},
    {time:"15:00", stay:10, snd:{bed:[["carriage",0.7],["murmur",0.6]]}, addr:"Kohlmarkt 9, 1010 Wien", lat:48.20860, lng:16.36780, radius:45, approx:true},
    {time:"19:00", stay:15, snd:{bed:[["murmur",0.7],["carriage",0.3]],music:"applause"}, addr:"Michaelerplatz, 1010 Wien", lat:48.20806, lng:16.36722, radius:55}
  ]
},
{
  id:"beethoven", mono:"LvB", sphere:"music", years:"1770–1827", vienna:[[1792, 1827]], dayYear:1802,
  voice:{rate:0.9,pitch:0.78},
  stops:[
    {time:"07:00", stay:10, snd:{bed:[["birds",0.8],["bell-village",0.3]],music:"elise"}, addr:"Probusgasse 6, 1190 Wien", lat:48.25484, lng:16.35619, radius:40},
    {time:"09:00", stay:10, snd:{bed:[["bell-village",0.8],["birds",0.5]]}, addr:"Pfarrplatz 3, 1190 Wien", lat:48.25481, lng:16.35900, radius:55},
    {time:"11:00", stay:10, snd:{bed:[["leaves",0.9],["birds",0.6]]}, addr:"Eroicagasse, 1190 Wien", lat:48.25670, lng:16.35780, radius:90, approx:true, moment:"hearing"},
    {time:"13:00", stay:20, snd:{bed:[["stream",0.9],["birds",0.7],["leaves",0.4]]}, addr:"Beethovengang, 1190 Wien", lat:48.25893, lng:16.35189, radius:60},
    {time:"20:00", stay:10, snd:{bed:[["fireplace",0.8],["bell-toll",0.25]]}, addr:"Probusgasse 6, 1190 Wien", lat:48.25484, lng:16.35619, radius:40}
  ]
},
{
  id:"klimt", mono:"GK", sphere:"painting", years:"1862–1918", vienna:[[1862, 1918]], dayYear:1908,
  voice:{rate:0.95,pitch:0.92},
  stops:[
    {time:"06:00", stay:5, snd:{bed:[["birds",0.6],["carriage",0.35],["tram",0.35]]}, addr:"Westbahnstraße 36, 1070 Wien", lat:48.20060, lng:16.34200, radius:80, approx:true},
    {time:"07:00", stay:15, snd:{bed:[["cafe",0.6],["birds",0.7]]}, addr:"Tivoligasse, 1120 Wien", lat:48.17960, lng:16.32400, radius:150, approx:true, transit:true},
    {time:"09:00", stay:10, snd:{bed:[["birds",0.8],["leaves",0.6]]}, addr:"Josefstädter Straße 21, 1080 Wien", lat:48.21015, lng:16.35220, radius:70, approx:true, transit:true},
    {time:"13:00", stay:10, snd:{bed:[["carriage",0.5],["tram",0.5],["murmur",0.5]]}, addr:"Mariahilfer Straße 1b, 1060 Wien", lat:48.20100, lng:16.36030, radius:60, approx:true},
    {time:"15:00", stay:20, snd:{bed:[["murmur",0.5],["carriage",0.4]],music:"ode"}, addr:"Friedrichstraße 12, 1010 Wien", lat:48.20052, lng:16.36568, radius:45},
    {time:"18:00", stay:20, snd:{bed:[["cafe",0.9]]}, addr:"Operngasse 7, 1010 Wien", lat:48.20151, lng:16.36755, radius:40},
    {time:"20:00", stay:10, snd:{bed:[["hammer",0.7],["murmur",0.3]]}, addr:"Lothringerstraße 20, 1030 Wien", lat:48.20070, lng:16.37700, radius:60}
  ]
},
{
  id:"freud", mono:"SF", sphere:"science", years:"1856–1939", vienna:[[1860, 1938]], dayYear:1907,
  voice:{rate:0.96,pitch:0.86},
  stops:[
    {time:"07:00", stay:10, snd:{bed:[["clock",0.9],["birds",0.3]]}, addr:"Berggasse 19, 1090 Wien", lat:48.21861, lng:16.36311, radius:40},
    {time:"13:45", stay:10, snd:{bed:[["carriage",0.6],["tram",0.5],["bells",0.35]]}, addr:"Rooseveltplatz, 1090 Wien", lat:48.21500, lng:16.35980, radius:70},
    {time:"14:05", stay:15, snd:{bed:[["fountain",0.7],["murmur",0.6]]}, addr:"Universitätsring 1, 1010 Wien", lat:48.21300, lng:16.36050, radius:60},
    {time:"14:20", stay:20, snd:{bed:[["cafe",0.9],["carriage",0.2]]}, addr:"Universitätsring 4, 1010 Wien", lat:48.21167, lng:16.36139, radius:40},
    {time:"14:40", stay:5, snd:{bed:[["carriage",0.5],["bell-toll",0.4],["murmur",0.3]]}, addr:"Schottenring 7, 1010 Wien", lat:48.21570, lng:16.36440, radius:60, approx:true},
    {time:"21:00", stay:10, snd:{bed:[["clock",0.8],["fireplace",0.5]]}, addr:"Berggasse 19, 1090 Wien", lat:48.21861, lng:16.36311, radius:40}
  ]
}
];

// Готовые аудиозаписи: язык → герои. Файлы: audio/<язык>/<герой>-<номер точки|intro|epilogue>.mp3
// Английские записи сгенерированы открытой моделью Kokoro-82M (Apache 2.0).
// Музыка в паузе «Осмотритесь»: наши записи общественного достояния (tools/sound/make-sounds.py)
export const MUSIC = {
  k265:{year:"1781–1782"}, k525:{year:"1787"}, elise:{year:"1810"}, ode:{year:"1824"}, applause:{}
};

export const RECORDINGS = { en: ["mozart","beethoven","klimt","freud"] };

export const UPCOMING = [
  {id:"strauss", mono:"JS", sphere:"music", years:"1825–1899", vienna:[[1825, 1899]]},
  {id:"elssler", mono:"FE", sphere:"ballet", years:"1810–1884", vienna:[[1810, 1834]]},
  {id:"mahler", mono:"GM", sphere:"music", years:"1860–1911", vienna:[[1875, 1878], [1897, 1907]]},
  {id:"lamarr", mono:"HL", sphere:"film", years:"1914–2000", vienna:[[1914, 1937]]},
  {id:"welles", mono:"OW", sphere:"film", years:"1915–1985", vienna:[[1948, 1948.4]]}
];

// Связи между героями; тексты — в content/<язык>.js, в том же порядке
export const LINKS = [
  {year:"1792", a:"mozart", b:"beethoven"},
  {year:"1900", a:"klimt", b:"freud"},
  {year:"1902", a:"klimt", b:"beethoven", c:"mahler"}
];

// Схематичный контекст карты; подписи (k) переводятся в i18n.js → map
export const CTX = {
  ring:[[48.2148,16.3627],[48.2152,16.3665],[48.2163,16.3712],[48.2140,16.3745],[48.2118,16.3778],[48.2113,16.3838],[48.2072,16.3806],[48.2045,16.3793],[48.2025,16.3770],[48.2016,16.3742],[48.2025,16.3695],[48.2033,16.3655],[48.2050,16.3625],[48.2080,16.3610],[48.2105,16.3622],[48.2130,16.3620],[48.2148,16.3627]],
  canal:[[48.2605,16.3700],[48.2500,16.3680],[48.2400,16.3610],[48.2330,16.3608],[48.2275,16.3650],[48.2220,16.3668],[48.2172,16.3722],[48.2125,16.3782],[48.2120,16.3845],[48.2112,16.3905],[48.2040,16.3990],[48.1920,16.4130]],
  wien:[[48.1885,16.3000],[48.1872,16.3130],[48.1870,16.3230],[48.1885,16.3380],[48.1925,16.3530],[48.1968,16.3590],[48.1990,16.3640],[48.2003,16.3705],[48.2012,16.3765],[48.2040,16.3800],[48.2115,16.3843]],
  brook:[[48.2605,16.3440],[48.2596,16.3490],[48.2589,16.3519],[48.2586,16.3560],[48.2590,16.3610],[48.2598,16.3670]],
  parks:[{k:"schoenbrunn", pts:[[48.1862,16.3035],[48.1862,16.3200],[48.1765,16.3200],[48.1765,16.3035]]}],
  labels:[
    {k:"ring", at:[[48.2090,16.3598],[48.2045,16.3808],[48.2021,16.3712],[48.2158,16.3690]]},
    {k:"canal", at:[[48.2135,16.3792],[48.2245,16.3690],[48.2420,16.3640],[48.2540,16.3700]]},
    {k:"wien", at:[[48.1905,16.3470],[48.1874,16.3160],[48.1990,16.3690]]},
    {k:"brook", at:[[48.2600,16.3455],[48.2595,16.3600]]}
  ],
  landmarks:[
    {k:"stephansdom",lat:48.20861,lng:16.37306},{k:"opera",lat:48.2031,lng:16.3692},{k:"hofburg",lat:48.2066,lng:16.3656},
    {k:"rathaus",lat:48.2108,lng:16.3573},{k:"karlskirche",lat:48.1982,lng:16.3718},{k:"belvedere",lat:48.1915,lng:16.3809},
    {k:"naschmarkt",lat:48.1983,lng:16.3615},{k:"prater",lat:48.2166,lng:16.3958},{k:"schoenbrunnPalace",lat:48.1848,lng:16.3122},
    {k:"westbahnhof",lat:48.1966,lng:16.3380},
    {k:"votivkirche",lat:48.21553,lng:16.35890},{k:"universitaet",lat:48.21316,lng:16.36010},
    {k:"burgtheater",lat:48.21040,lng:16.36130},{k:"parlament",lat:48.20820,lng:16.35850},
    {k:"musikverein",lat:48.20055,lng:16.37255},{k:"albertina",lat:48.20440,lng:16.36820},
    {k:"peterskirche",lat:48.20925,lng:16.36985}
  ]
};
