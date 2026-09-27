/*
 * 指纹采集：Window / Dedicated Worker / Service Worker 通用，不依赖 document/window 存在。
 * UMD 导出：浏览器/Worker 挂 self.collectFingerprint；Node 下 module.exports。
 * 约定：任何单项采集失败写入返回值 error 字段（{项名: 消息}），不影响其他项。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.collectFingerprint = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var HIGH_ENTROPY = ['architecture', 'bitness', 'fullVersionList', 'platform', 'platformVersion'];
  var CANVAS_W = 240;
  var CANVAS_H = 60;

  function cyrb53(str, seed) {
    var h1 = 0xdeadbeef ^ (seed || 0);
    var h2 = 0x41c6ce57 ^ (seed || 0);
    for (var i = 0, ch; i < str.length; i++) {
      ch = str.charCodeAt(i);
      h1 = Math.imul(h1 ^ ch, 2654435761);
      h2 = Math.imul(h2 ^ ch, 1597334677);
    }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507);
    h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507);
    h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    return 4294967296 * (2097151 & h2) + (h1 >>> 0);
  }

  function fnv1aHex(bytes) {
    var h = 0x811c9dc5;
    for (var i = 0; i < bytes.length; i++) {
      h ^= bytes[i];
      h = Math.imul(h, 0x01000193);
    }
    return ('0000000' + (h >>> 0).toString(16)).slice(-8);
  }

  function makeCanvas(isWindow) {
    if (isWindow) {
      var c = document.createElement('canvas');
      c.width = CANVAS_W;
      c.height = CANVAS_H;
      return c;
    }
    if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(CANVAS_W, CANVAS_H);
    return null;
  }

  function collectWebGL(isWindow) {
    var canvas = makeCanvas(isWindow);
    if (!canvas) return null;
    var gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
    if (!gl) return null;
    var ext = gl.getExtension('WEBGL_debug_renderer_info');
    return {
      vendor: ext ? gl.getParameter(ext.UNMASKED_VENDOR_WEBGL) : gl.getParameter(gl.VENDOR),
      renderer: ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER)
    };
  }

  // 统一对 PNG 编码字节做 FNV-1a：Window 用 toDataURL，Worker 用 convertToBlob，
  // 同为浏览器 PNG 编码器输出，跨上下文可比较。
  function collectCanvasHash(isWindow) {
    var canvas = makeCanvas(isWindow);
    if (!canvas) return Promise.resolve(null);
    var ctx = canvas.getContext('2d');
    if (!ctx) return Promise.resolve(null);

    var g1 = ctx.createLinearGradient(0, 0, CANVAS_W, 0);
    g1.addColorStop(0, '#ff6600');
    g1.addColorStop(1, '#006699');
    ctx.fillStyle = g1;
    ctx.fillRect(0, 0, CANVAS_W / 2, CANVAS_H);

    var g2 = ctx.createLinearGradient(0, 0, 0, CANVAS_H);
    g2.addColorStop(0, 'rgba(0,255,0,0.7)');
    g2.addColorStop(1, 'rgba(0,0,255,0.3)');
    ctx.fillStyle = g2;
    ctx.fillRect(CANVAS_W / 2, 0, CANVAS_W / 2, CANVAS_H);

    ctx.font = '16px Arial';
    ctx.textBaseline = 'top';
    ctx.fillStyle = '#ff00ff';
    ctx.fillText('fp-consistency 🌐', 4, 20);

    if (typeof canvas.toDataURL === 'function') {
      var b64 = canvas.toDataURL('image/png').split(',')[1] || '';
      var bin = atob(b64);
      var bytes = new Uint8Array(bin.length);
      for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      return Promise.resolve(fnv1aHex(bytes));
    }
    if (typeof canvas.convertToBlob === 'function') {
      return canvas.convertToBlob({ type: 'image/png' }).then(function (blob) {
        return blob.arrayBuffer();
      }).then(function (buf) {
        return fnv1aHex(new Uint8Array(buf));
      });
    }
    return Promise.resolve(null);
  }

  // 0.5s 440Hz 正弦波 → 输出 buffer 前 1000 采样求和 → cyrb53 hex。无 AudioContext 记 null。
  function collectAudioHash() {
    if (typeof OfflineAudioContext === 'undefined') return Promise.resolve(null);
    var ctx = new OfflineAudioContext(1, 22050, 44100);
    var osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = 440;
    osc.connect(ctx.destination);
    osc.start(0);
    return ctx.startRendering().then(function (buf) {
      var data = buf.getChannelData(0);
      var n = Math.min(1000, data.length);
      var sum = 0;
      for (var i = 0; i < n; i++) sum += data[i];
      return cyrb53(String(sum)).toString(16);
    });
  }

  function collectScreen(isWindow) {
    if (!isWindow || typeof screen === 'undefined') return null;
    return {
      width: screen.width,
      height: screen.height,
      availWidth: screen.availWidth,
      availHeight: screen.availHeight,
      colorDepth: screen.colorDepth,
      dpr: typeof devicePixelRatio === 'number' ? devicePixelRatio : null
    };
  }

  async function collectFingerprint() {
    var isWindow = typeof window !== 'undefined' && typeof document !== 'undefined';
    var errors = {};

    async function item(name, fn) {
      try {
        return await fn();
      } catch (e) {
        errors[name] = String((e && e.message) || e);
        return null;
      }
    }

    var fp = {
      userAgent: await item('userAgent', function () { return navigator.userAgent; }),
      uaData: await item('uaData', function () {
        var uad = navigator.userAgentData;
        return (uad && uad.getHighEntropyValues) ? uad.getHighEntropyValues(HIGH_ENTROPY) : null;
      }),
      brands: await item('brands', function () {
        var uad = navigator.userAgentData;
        return (uad && uad.brands)
          ? uad.brands.map(function (b) { return { brand: b.brand, version: b.version }; })
          : null;
      }),
      hardwareConcurrency: await item('hardwareConcurrency', function () {
        return typeof navigator.hardwareConcurrency === 'number' ? navigator.hardwareConcurrency : null;
      }),
      deviceMemory: await item('deviceMemory', function () { return navigator.deviceMemory ?? null; }),
      platform: await item('platform', function () { return navigator.platform ?? null; }),
      languages: await item('languages', function () {
        if (navigator.languages && navigator.languages.length) return Array.prototype.slice.call(navigator.languages);
        return navigator.language ? [navigator.language] : null;
      }),
      timezone: await item('timezone', function () {
        return Intl.DateTimeFormat().resolvedOptions().timeZone || null;
      }),
      webdriver: await item('webdriver', function () {
        return typeof navigator.webdriver === 'undefined' ? null : navigator.webdriver;
      }),
      webgl: await item('webgl', function () { return collectWebGL(isWindow); }),
      canvasHash: await item('canvasHash', function () { return collectCanvasHash(isWindow); }),
      audioHash: await item('audioHash', function () { return collectAudioHash(); }),
      screen: await item('screen', function () { return collectScreen(isWindow); }),
      hasChrome: await item('hasChrome', function () {
        return isWindow ? typeof window.chrome : 'n/a';
      }),
      plugins: await item('plugins', function () {
        return isWindow ? (navigator.plugins ? navigator.plugins.length : null) : null;
      })
    };
    fp.error = Object.keys(errors).length ? errors : null;
    return fp;
  }

  return collectFingerprint;
});
