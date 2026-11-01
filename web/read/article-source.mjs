// 文章来源选择：先把「今天的文章从哪来」定下来，再去请求扇贝。
// 优先级：命令行链接 > data/article-pin.json > 词文串学匹配文章 > 最新短文。

export function articleIdFromInput(input){
  if(!input)return null;
  const text=String(input).trim().replace(/[?#].*$/,'');
  const match=text.match(/articles\/([A-Za-z0-9]+)/);
  const id=match?match[1]:text;
  if(!/^[A-Za-z0-9]+$/.test(id))throw new Error(`无法从「${input}」里读出文章 id`);
  return id;
}

export function sourcePlan({input=null,pin=null,latestOnly=false}={}){
  if(input)return {mode:'explicit',articleId:articleIdFromInput(input)};
  if(pin)return {mode:'pin',articleId:articleIdFromInput(pin)};
  if(latestOnly)return {mode:'latest',articleId:null};
  return {mode:'cross-learning',articleId:null};
}

export function crossLearningArticleId(payload){
  const id=payload?.id||payload?.article?.id;
  if(!id)throw new Error('词文串学没有返回文章 id');
  return String(id);
}

export function associationWords(sentences){
  const words=[];const seen=new Set();
  for(const sentence of sentences||[])for(const vocab of sentence?.vocab_indexes||[]){
    const word=String(vocab?.word||'').trim();
    const key=word.toLowerCase();
    if(word&&!seen.has(key)){seen.add(key);words.push(word);}
  }
  return words;
}

export function matchedTodayWords(words,matchedVocabIds){
  const matched=new Set((matchedVocabIds||[]).map(String));
  return (words||[]).filter(word=>matched.has(String(word.id))).map(word=>word.word);
}
