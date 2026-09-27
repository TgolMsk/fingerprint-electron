const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

// splitmix64：确定性伪随机。输入 seed(hex 16 位) + 用途字符串，输出 [0,1) 的稳定随机数。
// 同一 (seed, purpose) 永远得到同一结果，保证"只生成一次"之前的生成过程可复现、可审计。
function deriveRandom(seedHex, purpose) {
  let h = BigInt('0x' + seedHex);
  for (const ch of purpose) {
    h ^= BigInt(ch.codePointAt(0));
    h = BigInt.asUintN(64, h * 0x9e3779b97f4a7c15n);
  }
  h = BigInt.asUintN(64, h + 0x9e3779b97f4a7c15n);
  let z = h;
  z = BigInt.asUintN(64, (z ^ (z >> 30n)) * 0xbf58476d1ce4e5b9n);
  z = BigInt.asUintN(64, (z ^ (z >> 27n)) * 0x94d049bb133111ebn);
  z = z ^ (z >> 31n);
  return Number(z >> 11n) / 0x20000000000000;
}

function pick(seed, purpose, arr) {
  return arr[Math.floor(deriveRandom(seed, purpose) * arr.length)];
}

let templatesCache = null;
function loadTemplates() {
  if (templatesCache) return templatesCache;
  const dir = path.join(__dirname, '..', 'profiles');
  templatesCache = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')));
  if (templatesCache.length === 0) {
    throw new Error('profiles/ 目录下没有任何设备模板');
  }
  return templatesCache;
}

// geoHint 预留给将来按代理 IP 国家填写，例如 { language: 'zh-CN', timezone: 'Asia/Shanghai' }
function generateFingerprint(geoHint = {}) {
  const seed = crypto.randomBytes(8).toString('hex');
  const templates = loadTemplates();
  const tpl = pick(seed, 'template', templates);

  // UA 版本必须等于内核真实 Chromium 版本，这是硬规则
  const chromeVer = process.versions.chrome;
  if (!chromeVer) throw new Error('请在定制 Electron 主进程中生成指纹配置。');

  const cores = pick(seed, 'cores', tpl.cores);
  const memory = pick(seed, 'memory', tpl.memory);
  const res = pick(seed, 'resolution', tpl.resolutions);
  const gpu = pick(seed, 'gpu', tpl.gpus);

  const language = geoHint.language || 'en-US';
  const languages = language === 'en-US' ? ['en-US', 'en'] : [language, language.split('-')[0]];

  return {
    schemaVersion: 1,
    seed,
    uaString: `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chromeVer} Safari/537.36`,
    ua: {
      brand: 'Google Chrome',
      fullVersion: chromeVer,
      platform: tpl.uaPlatform,
      platformVersion: tpl.platformVersion,
      arch: 'x86',
      bitness: '64',
    },
    navigator: {
      platform: tpl.platform,
      hardwareConcurrency: cores,
      deviceMemory: memory,
      languages,
    },
    screen: {
      width: res.width,
      height: res.height,
      availWidth: res.width,
      availHeight: res.height - 40, // 任务栏
      colorDepth: 24,
      dpr: 1,
    },
    webgl: {
      vendor: gpu.vendor,
      renderer: gpu.renderer,
    },
    timezone: geoHint.timezone || 'America/New_York',
    fonts: 'win-default',
    noise: { canvas: true, audio: true, rects: true },
    disable: [],
  };
}

module.exports = { generateFingerprint };
