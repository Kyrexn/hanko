// Documento invisível da extensão: o único lugar onde ela pode mexer na área de transferência
// sem o popup aberto. Apaga o que foi copiado depois do tempo escolhido.

let timer: ReturnType<typeof setTimeout> | undefined;

function write(text: string) {
  const t = document.getElementById('t') as HTMLTextAreaElement;
  t.value = text || ' ';
  t.select();
  document.execCommand('copy');
  t.value = '';
}

chrome.runtime.onMessage.addListener((msg: { type: string; seconds?: number }) => {
  if (msg.type !== 'offscreen-clear') return;
  clearTimeout(timer);
  timer = setTimeout(() => {
    write('');
    chrome.runtime.sendMessage({ type: 'offscreen-done' }).catch(() => {});
  }, Math.max(5, msg.seconds || 30) * 1000);
});
