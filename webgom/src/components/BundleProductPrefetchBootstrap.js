const MAX_BOOTSTRAP_PREFETCHES = 6;

export default function BundleProductPrefetchBootstrap({ descriptors = [] }) {
  const uniqueDescriptors = [];
  const seenKeys = new Set();

  descriptors.forEach((descriptor) => {
    if (
      !descriptor?.key
      || !descriptor?.storageKey
      || !descriptor?.url
      || seenKeys.has(descriptor.key)
      || uniqueDescriptors.length >= MAX_BOOTSTRAP_PREFETCHES
    ) {
      return;
    }

    seenKeys.add(descriptor.key);
    uniqueDescriptors.push(descriptor);
  });

  if (uniqueDescriptors.length === 0) {
    return null;
  }

  const script = `
(function(){
  var entries=${JSON.stringify(uniqueDescriptors)};
  if(!Array.isArray(entries)||entries.length===0||typeof window==="undefined"){return;}
  window.__webgomBundlePrefetch=window.__webgomBundlePrefetch||{active:0,queue:[],seen:{}};
  var state=window.__webgomBundlePrefetch;
  var maxActive=2;
  function isCached(entry){
    try{
      var raw=window.sessionStorage.getItem(entry.storageKey);
      var payload=raw?JSON.parse(raw):null;
      return Number(payload&&payload.cache_version)===Number(entry.cacheVersion);
    }catch(error){return false;}
  }
  function cache(entry,payload){
    if(!payload||typeof payload!=="object"){return;}
    try{
      payload.cache_version=entry.cacheVersion;
      payload.cached_at=Date.now();
      window.sessionStorage.setItem(entry.storageKey,JSON.stringify(payload));
    }catch(error){}
  }
  function pump(){
    if(state.active>=maxActive||state.queue.length===0){return;}
    var entry=state.queue.shift();
    if(!entry||isCached(entry)){pump();return;}
    state.active+=1;
    fetch(entry.url,{headers:{Accept:"application/json","X-Site-Code":entry.siteCode||""}})
      .then(function(response){return response.ok?response.json():null;})
      .then(function(payload){cache(entry,payload);})
      .catch(function(){})
      .finally(function(){state.active=Math.max(0,state.active-1);pump();});
    pump();
  }
  entries.forEach(function(entry){
    if(!entry||state.seen[entry.key]||isCached(entry)){return;}
    state.seen[entry.key]=true;
    state.queue.push(entry);
  });
  window.setTimeout(pump,60);
})();`;

  return (
    <script
      type="text/javascript"
      dangerouslySetInnerHTML={{ __html: script }}
      suppressHydrationWarning
    />
  );
}
