import { decode } from './vendor/decode.mjs';

export function parseCookie(input) {
  let text = String(input || '').trim();
  if(text.startsWith('{')){try{const json=JSON.parse(text);const obj=json['请求 Cookie']||json.cookies||json;text=Object.entries(obj).filter(([k])=>['auth_token','csrftoken','_c_WBKFRo'].includes(k)).map(([k,v])=>k+'='+v).join('; ');}catch{throw new Error('Cookie JSON 格式无效');}}
  const patterns = [/(?:^|\s)(?:-b|--cookie)\s+\$?'([^']+)'/i, /(?:^|\s)(?:-b|--cookie)\s+"([^"]+)"/i, /(?:^|\s)(?:-H|--header)\s+\$?'cookie:\s*([^']+)'/i, /(?:^|\s)(?:-H|--header)\s+"cookie:\s*([^"]+)"/i];
  const cookie = patterns.map(p => text.match(p)?.[1]).find(Boolean) || text.replace(/^cookie:\s*/i, '');
  if (/\r|\n/.test(cookie) || !/(?:^|;\s*)auth_token=([^;]+)/.test(cookie) || cookie.length > 20000) throw new Error('未找到 auth_token。请粘贴扇贝请求的 Cookie，或复制为 cURL 的完整内容。');
  return cookie;
}

export function unpack(value) {
  if (typeof value?.data === 'string') {
    if (value.data.length > 8_000_000) throw new Error('接口数据过大');
    const plain = decode(value.data);
    if (!plain) throw new Error('今日单词解码失败，接口格式可能已变更');
    return JSON.parse(plain);
  }
  return value;
}

export function normalize(item, type, unfinished, finished) {
  const v = item.vocab_with_senses || item.vocabulary || item.vocab || {};
  if (!v.word || !v.id) throw new Error('单词字段与已核对的接口结构不一致');
  return { id: String(v.id), word: v.word, type: item.type_of || type,
    unknownCount: typeof item.unknown_count === 'number' ? item.unknown_count : null,
    state: unfinished.has(String(v.id)) ? '未完成' : finished ? '已完成' : '待核实',
    senses: (v.senses || []).map(s => ({pos:s.pos || '', cn:s.definition_cn || '', en:s.definition_en || ''})) };
}

export class Shanbay {
  constructor(cookie, transport = fetch) { this.cookie = cookie; this.transport = transport; }
  async request(path, body) {
    const headers = {Accept:'application/json', Cookie:this.cookie, Origin:'https://web.shanbay.com', Referer:'https://web.shanbay.com/', 'User-Agent':'Mozilla/5.0'};
    const csrf = this.cookie.match(/(?:^|;\s*)csrftoken=([^;]+)/)?.[1];
    if (csrf) headers['X-CSRFToken'] = csrf;
    if (body) headers['Content-Type'] = 'application/json';
    const response = await this.transport('https://apiv3.shanbay.com' + path, {method:body ? 'POST':'GET',headers,body:body ? JSON.stringify(body):undefined,signal:AbortSignal.timeout(25000),redirect:'error'});
    if (!response.ok) {
      const messages = {401:'登录已失效，请重新连接',403:'请求被拒绝，请在官方网页确认登录状态',412:'今日学习数据尚未就绪，请先打开官方学习页后重试'};
      throw new Error(messages[response.status] || `扇贝接口返回 HTTP ${response.status}：${path.split('?')[0]}`);
    }
    if (response.status === 204) return {};
    return response.json();
  }
  async today() {
    const book = await this.request('/wordsapp/user_material_books/current');
    const id = book.materialbook_id || book.materialbook?.id;
    if (!id || !/^[\w-]+$/.test(String(id))) throw new Error('未找到当前词书 ID');
    const base = `/wordsapp/user_material_books/${id}/learning/`;
    const status = await this.request(base+'statuses');
    const sync = await this.request(base+'items/sync');
    const unfinished = new Set([...(sync.a_not_finished_items || []),...(sync.c_not_finished_items || [])].map(i=>String(i.item_id)));
    const words = [];
    for (const type of ['NEW','REVIEW']) {
      let loaded = 0;
      for (let page=1; page<=100; page++) {
        const data = unpack(await this.request(base+`words/today_learning_items?type_of=${type}&page=${page}&ipp=50`));
        if (!Array.isArray(data.objects) || !Number.isFinite(data.total)) throw new Error('今日单词分页格式已改变');
        words.push(...data.objects.map(i=>normalize(i,type,unfinished,status.is_finished === true)));
        loaded += data.objects.length;
        if (loaded >= data.total) break;
        if (!data.objects.length || page===100) throw new Error('今日单词未读取完整，请稍后重试');
      }
    }
    return { fetchedAt:new Date().toISOString(), date:status.date || sync.date || null, book:book.materialbook?.name || '当前词书', status, words };
  }
}
