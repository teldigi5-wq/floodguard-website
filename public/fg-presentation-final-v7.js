(()=>{'use strict';
const clear=()=>{try{if('serviceWorker'in navigator)navigator.serviceWorker.getRegistrations().then(rs=>Promise.all(rs.map(r=>r.unregister()))).catch(()=>{});if('caches'in window)caches.keys().then(ks=>Promise.all(ks.map(k=>caches.delete(k)))).catch(()=>{});}catch{}};
clear();
console.info('FloodGuard Presentation Final V7: Firebase water display = 25cm - live HC-SR04 air gap; SAFE <8.5, WARNING 8.5-<11, DANGER >=11.');
})();
