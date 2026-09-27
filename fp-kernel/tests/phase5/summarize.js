// Summarize recorded detector evidence without launching or changing a browser.
const fs = require('node:fs');
const path = require('node:path');
const run = path.resolve(process.argv[2] || '');
if (!fs.existsSync(path.join(run, 'manifest.json'))) throw new Error('Usage: node summarize.js <recorded run directory>');
const manifest = JSON.parse(fs.readFileSync(path.join(run, 'manifest.json'), 'utf8'));
const relativeRun = path.relative(path.resolve(__dirname, '../../reports/phase5'), run).replaceAll('\\', '/');
const load = file => JSON.parse(fs.readFileSync(path.join(run, file), 'utf8'));
const md = value => String(value ?? '').replaceAll('|', '\\|').replaceAll('\n', ' ');
const summaries = manifest.results.map(result => {
  const summary = { id: result.id, status: result.status, account: result.account, site: result.site, error: result.error, loadErrors: result.loadErrors, failedRequests: result.failedRequests };
  if (result.status !== 'COLLECTED') return summary;
  const probe = load(`${result.id}.probe.json`);
  summary.probe = { webdriver: probe.webdriver, plugins: probe.plugins.map(plugin => plugin.name), mimeTypeCount: probe.mimeTypes.length, pdfViewerEnabled: probe.pdfViewerEnabled, chromeKeys: probe.chrome.keys, chromeNativeFunctions: Object.values(probe.chrome.functions).every(fn => /\[native code\]/.test(fn.source)), chromeLoadTimesKeys: Object.keys(probe.chrome.functions.loadTimes.result), chromeCsiKeys: Object.keys(probe.chrome.functions.csi.result), chromeAppKeys: probe.chrome.appKeys, languages: probe.languages, timezone: probe.timezone, voices: probe.voices, media: probe.media };
  if (result.id.startsWith('creepjs-')) {
    let fingerprint;
    const fpFile = path.join(run, `${result.id}.fingerprint.json`);
    if (fs.existsSync(fpFile)) fingerprint = load(`${result.id}.fingerprint.json`);
    else {
      for (const entry of result.console || []) {
        if (!entry.message.startsWith('diff check')) continue;
        try {
          const candidate = JSON.parse(entry.message.slice(entry.message.indexOf('{')));
          if (candidate.lies && candidate.headless) fingerprint = candidate;
        } catch (_) { /* Missing or unparsable evidence remains incomplete. */ }
      }
      if (fingerprint) fs.writeFileSync(fpFile, JSON.stringify(fingerprint, null, 2));
    }
    if (fingerprint) {
      summary.totalLies = fingerprint.lies.totalLies;
      summary.lies = fingerprint.lies.data;
      summary.likeHeadless = fingerprint.headless.likeHeadlessRating;
      summary.headless = fingerprint.headless.headlessRating;
      summary.stealth = fingerprint.headless.stealthRating;
      summary.likeHeadlessFlags = Object.keys(fingerprint.headless.likeHeadless).filter(key => fingerprint.headless.likeHeadless[key]);
      summary.trash = fingerprint.trash.trashBin;
      summary.capturedErrors = fingerprint.capturedErrors.data;
      summary.verdict = summary.totalLies ? 'LIES_OBSERVED' : 'NO_LIES_IN_SITE_RESULT';
    } else summary.verdict = 'INCOMPLETE_OR_REQUIRES_REVIEW';
  } else {
    summary.passed = result.passedRows?.length || 0;
    summary.failed = result.failedRows?.length || 0;
    summary.warned = result.warnRows?.length || 0;
    summary.failedRows = result.failedRows || [];
    summary.verdict = summary.failed ? 'FAILURES_OBSERVED' : summary.passed >= 31 && !summary.warned ? 'OBSERVED_CHECKS_PASSED' : 'INCOMPLETE_OR_REQUIRES_REVIEW';
  }
  return summary;
});
const summary = { run, label: manifest.label, startedAt: manifest.startedAt, finishedAt: manifest.finishedAt, executableModifiedAt: manifest.executableModifiedAt, executableSha256: manifest.executableSha256, sourceRevisionReportedByBuild: manifest.sourceRevisionReportedByBuild, versions: { electron: manifest.versions.electron, chrome: manifest.versions.chrome, fpkernel: manifest.versions.fpkernel }, results: summaries, realChrome152Comparison: manifest.realChrome152Comparison };
fs.writeFileSync(path.join(run, 'summary.json'), JSON.stringify(summary, null, 2));
const collected = summaries.filter(result => result.status === 'COLLECTED');
const sanny = collected.filter(result => result.id.startsWith('sannysoft-'));
const creep = collected.filter(result => result.id.startsWith('creepjs-'));
const rows = summaries.map(result => `| ${result.account} | ${result.id.startsWith('creepjs-') ? 'CreepJS' : 'Sannysoft'} | ${result.status} | ${result.id.startsWith('creepjs-') ? result.verdict ? `${result.totalLies} lies；${result.likeHeadless}% like headless / ${result.headless}% headless / ${result.stealth}% stealth` : result.error : result.verdict ? `${result.passed} passed / ${result.failed} failed / ${result.warned} warning` : result.error} | [原始结果](${relativeRun}/${result.id.startsWith('creepjs-') ? `${result.id}.fingerprint.json` : `${result.id}.page.json`}) · [截图](${relativeRun}/${result.id}.png) |`).join('\n');
const lieRows = creep.flatMap(result => Object.entries(result.lies || {}).map(([api, messages]) => `| ${result.account} | ${api} | ${md(messages.join('; '))} |`)).join('\n');
const first = collected[0]?.probe;
const pluginNames = ['PDF Viewer', 'Chrome PDF Viewer', 'Chromium PDF Viewer', 'Microsoft Edge PDF Viewer', 'WebKit built-in PDF'];
const pdfMatches = collected.filter(result => JSON.stringify(result.probe.plugins) === JSON.stringify(pluginNames) && result.probe.mimeTypeCount === 2 && result.probe.pdfViewerEnabled === true).length;
const chromeMatches = collected.filter(result => result.probe.chromeKeys.slice().sort().join(',') === 'app,csi,loadTimes' && result.probe.chromeLoadTimesKeys.length === 13 && result.probe.chromeCsiKeys.length === 4 && result.probe.chromeAppKeys.length === 7 && result.probe.chromeNativeFunctions).length;
const webdriverMatches = collected.filter(result => result.probe.webdriver === false).length;
const requests = summaries.flatMap(result => (result.failedRequests || []).map(request => `- ${result.id}: \`${request.error}\`，${request.url}`));
const allSitesLoaded = summaries.every(result => result.status === 'COLLECTED');
const lines = [
  '# 阶段 5 检测报告', '',
  `运行标签：**${manifest.label}**。采集时间：${manifest.startedAt} 至 ${manifest.finishedAt || '尚未完成'}（UTC）。`, '',
  `结论：${sanny.length && sanny.every(result => result.verdict === 'OBSERVED_CHECKS_PASSED') ? `Sannysoft 的 ${sanny.length} 个虚构账号均观察到 31 项通过、0 项失败。` : 'Sannysoft 仍有失败、未完成或待复核结果。'}${creep.some(result => result.totalLies > 0) ? 'CreepJS 检出 lies，不能判定为全部通过。' : 'CreepJS 结果见下表，不以采集成功代替检测结论。'}${allSitesLoaded ? '本次两个站点主页面均可访问。' : '存在导航或采集失败，见原始证据。'}同版本真 Chrome 152 对照尚未测试。`, '',
  '## 环境与复现', '',
  `- 内核：Electron ${manifest.versions.electron} / Chromium ${manifest.versions.chrome} / fpkernel ${manifest.versions.fpkernel}。`,
  `- 可执行文件：\`${manifest.executable}\`；文件修改时间：${manifest.executableModifiedAt}。`,
  `- 可执行文件 SHA256：\`${manifest.executableSha256 || '未记录'}\`；构建侧报告的修复提交：\`${manifest.sourceRevisionReportedByBuild || '未提供'}\`。${manifest.hashVerifiedAfterCaptureAt ? `Hash 在采集结束后 ${manifest.hashVerifiedAfterCaptureAt} 复核。` : ''}`,
  `- 独立临时 userData：\`${manifest.stateRoot}\`；固定虚构账号，直连，无真实账户、登录或验证码交互。`,
  '- 公共页面：[CreepJS](https://abrahamjuliot.github.io/creepjs/)、[Sannysoft](https://bot.sannysoft.com/)。',
  '- 浏览器设置：plugins:true、sandbox、contextIsolation、nodeIntegration:false；禁用非代理 WebRTC UDP；未授权摄像头、麦克风或字体访问。',
  '- 采集器为隐藏 BrowserWindow，1440×1100 设定视口，无 Demo 翻译 preload，明确拒绝全部权限；这些设置与真实 Demo 的窗口和权限行为可能不同，不能把这里的结果替代 Demo 本身验收。',
  `- [复现说明](../../tests/phase5/README.md)、[原始 manifest](${relativeRun}/manifest.json)、[结构化汇总](${relativeRun}/summary.json)。`, '',
  '## 真实站点结果', '',
  '| 虚构账号 | 站点 | 采集状态 | 站点结果 | 证据 |', '| --- | --- | --- | --- | --- |', rows, '',
  '`COLLECTED` 和采集进程退出码 0 仅表示结果已保存。Sannysoft 的 passed 来自实际 DOM 类名；CreepJS 的 lies 来自站点在 console 输出的 Loose Fingerprint JSON。没有把本地 PASS 或页面功能模块的 passed 日志当作外部全绿。', '',
  '## CreepJS 检出的差异', '',
  '| 虚构账号 | API | 站点原始判断 |', '| --- | --- | --- |', lieRows || '| — | — | 没有可用 lies 数据；请检查原始结果是否完成 |', '',
  ...creep.map(result => `- 账号 ${result.account}：like-headless 触发项为 ${result.likeHeadlessFlags?.map(flag => `\`${flag}\``).join('、')}；trash ${result.trash?.length ?? '未知'} 项，capturedErrors ${result.capturedErrors?.length ?? '未知'} 项。`),
  '- `notificationIsDenied` 与本次明确拒绝权限的采集设置有关；其余分值按站点原样保留。0% headless 或 0% stealth 不能抵消 lies。', '',
  '## plugins / PDF / window.chrome 复核', '',
  first ? `本轮 ${collected.length} 个成功采集页面均记录了 API 原值。首个页面：webdriver=${first.webdriver}；PDF 插件 ${first.plugins.length} 项；mimeTypes ${first.mimeTypeCount} 项；pdfViewerEnabled=${first.pdfViewerEnabled}；window.chrome 键 ${first.chromeKeys.join(', ')}；loadTimes ${first.chromeLoadTimesKeys.length} 键，csi ${first.chromeCsiKeys.length} 键，app ${first.chromeAppKeys.length} 键；loadTimes/csi 为 native 函数文本。逐页数据见 \`*.probe.json\`。` : '未获得可用 API 探测数据。', '',
  `逐页核验：webdriver=false ${webdriverMatches}/${collected.length}；五个标准 PDF 插件、两个 MIME type 和 pdfViewerEnabled=true ${pdfMatches}/${collected.length}；chrome 三键、13/4/7 子键数及 native 文本 ${chromeMatches}/${collected.length}。这是内核结果自身的形状核验，尚未与同版本真 Chrome 对照。`, '',
  first ? `插件名称：${first.plugins.join('；')}。` : '', '',
  '**尚未测试**：与同版本、同系统真 Chrome 152 的属性描述符、键顺序、函数名称及行为逐项对照；当前没有匹配基准浏览器。插件枚举通过也不等于已验收 PDF 文档实际加载/打印。', '',
  '## 网络、错误与覆盖范围', '',
  ...requests,
  '- Sannysoft 的不存在图片和 itsgonnafail WebSocket 是故意失败的检测目标；保留其网络错误，不将其误记为主站不可达。其他子资源错误同样保留。',
  '- 站点 console 中无参 sendBeacon / getUserMedia 等异常保留在 manifest；本报告不隐藏站点或内核警告。',
  '- 本轮未测试真实设备采集、指定模板 deviceId 的 exact 选设备、实际 TTS 合成、外部账号登录、代理国家/IP 匹配或真实账户风控。媒体枚举模板不代表可用物理设备，语音模板不代表对应语音引擎实际可发声。',
  '- CreepJS 的特征版本库在本次 console 中以 Chrome 115 特征对照 Chrome 152；不将其 Features 113–115+ 展示误当成内核实际版本。',
  '- 检测站点随时可能改变；该报告仅覆盖证据目录所记录的本次运行。', '',
];
fs.writeFileSync(path.resolve(__dirname, '../../reports/phase5/REPORT.md'), lines.join('\n'));
console.log(JSON.stringify({ report: path.resolve(__dirname, '../../reports/phase5/REPORT.md'), results: summaries.map(({ id, status, verdict, totalLies, passed, failed }) => ({ id, status, verdict, totalLies, passed, failed })) }, null, 2));
