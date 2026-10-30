// [上番報告] 現場に掲示する報告用QR（A4縦）を印刷様式HTMLで生成し、印刷(PDF保存)する。
const esc = (s: string): string => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!))

export function printSiteQr(siteName: string, url: string, qrDataUrl: string): boolean {
  const html = `<!doctype html><html lang="ja"><head><meta charset="utf-8"><title>上番報告QR ${esc(siteName)}</title>
<style>
  @page{size:A4 portrait;margin:14mm;}
  *{box-sizing:border-box;margin:0;padding:0;font-family:'Yu Gothic','Hiragino Kaku Gothic ProN',sans-serif;color:#0f1c34;}
  body{display:flex;flex-direction:column;align-items:center;gap:8mm;text-align:center;}
  .brand{font-size:12pt;letter-spacing:.1em;color:#1E3A5F;font-weight:700;}
  h1{font-size:30pt;line-height:1.3;}
  .sub{font-size:16pt;font-weight:700;}
  img{width:110mm;height:110mm;}
  ol{list-style:none;display:flex;flex-direction:column;gap:3mm;font-size:14pt;text-align:left;border:1px solid #b9c1cf;border-radius:4mm;padding:6mm 8mm;width:150mm;}
  ol li b{display:inline-block;width:9mm;height:9mm;border-radius:50%;background:#1E3A5F;color:#fff;text-align:center;line-height:9mm;margin-right:3mm;font-size:12pt;}
  .url{font-size:9pt;color:#555;word-break:break-all;}
</style></head><body>
  <div class="brand">MAMOR-AI 上番報告</div>
  <h1>${esc(siteName)}</h1>
  <div class="sub">出発連絡・上番連絡はこのQRから</div>
  <img src="${esc(qrDataUrl)}" alt="報告用QRコード">
  <ol>
    <li><b>1</b>スマホのカメラでQRを読み取る</li>
    <li><b>2</b>初回のみ スタッフNo と PIN で本人登録</li>
    <li><b>3</b>「出発連絡」「上番連絡」を押して［はい］</li>
  </ol>
  <div class="url">${esc(url)}</div>
</body></html>`
  const w = window.open('', '_blank', 'width=820,height=1100')
  if (w === null) return false
  w.document.open()
  w.document.write(html)
  w.document.close()
  w.addEventListener('load', () => { w.focus(); w.print() })
  return true
}
