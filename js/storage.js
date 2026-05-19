/**
 * 数据持久化
 *   - profile / apiKeys 走 localStorage
 *   - meals + 原图 Blob 走 IndexedDB
 */
window.Storage = (function () {
  const idb = window.idb;  // 来自 idb UMD bundle

  const DB_NAME = 'diet-mgmt';
  const DB_VERSION = 1;

  const STORE_MEALS  = 'meals';
  const STORE_IMAGES = 'images';

  let dbPromise = null;
  function getDB() {
    if (!dbPromise) {
      dbPromise = idb.openDB(DB_NAME, DB_VERSION, {
        upgrade(db) {
          if (!db.objectStoreNames.contains(STORE_MEALS)) {
            const s = db.createObjectStore(STORE_MEALS, { keyPath: 'id' });
            s.createIndex('byTimestamp', 'timestamp');
          }
          if (!db.objectStoreNames.contains(STORE_IMAGES)) {
            db.createObjectStore(STORE_IMAGES, { keyPath: 'id' });
          }
        }
      });
    }
    return dbPromise;
  }

  // ------- profile -------
  function getProfile() {
    const raw = localStorage.getItem('diet:profile');
    if (!raw) return null;
    try { return JSON.parse(raw); }
    catch (e) { console.warn('profile parse fail', e); return null; }
  }
  function setProfile(p) {
    localStorage.setItem('diet:profile', JSON.stringify(p));
  }
  function clearProfile() {
    localStorage.removeItem('diet:profile');
  }

  // ------- api keys -------
  function getApiKeys() {
    const raw = localStorage.getItem('diet:apikeys');
    let parsed = {};
    try { parsed = raw ? JSON.parse(raw) : {}; } catch (e) { parsed = {}; }
    // 默认值 ← config.local.js 中的预设 ← localStorage 中已存的
    const defaults = Object.assign({
      vision: '',
      visionBaseUrl: '',
      visionModel: 'gemini-2.5-flash',
      deepseek: '',
      deepseekProxy: 'http://localhost:8787/deepseek',
      coachProvider: 'deepseek',
    }, window.__DEFAULT_CONFIG__ || {});
    return Object.assign(defaults, parsed);
  }
  function setApiKeys(k) {
    localStorage.setItem('diet:apikeys', JSON.stringify(k));
  }

  // ------- meals -------
  async function saveMeal(meal) {
    const db = await getDB();
    await db.put(STORE_MEALS, meal);
    return meal.id;
  }

  async function deleteMeal(id) {
    const db = await getDB();
    const meal = await db.get(STORE_MEALS, id);
    if (meal && meal.imageRef) {
      try { await db.delete(STORE_IMAGES, meal.imageRef); } catch (e) {}
    }
    await db.delete(STORE_MEALS, id);
  }

  /** 取一段时间范围内的 meals（含开始、含结束，按 timestamp 升序） */
  async function listMeals(fromTs, toTs) {
    const db = await getDB();
    const all = await db.getAllFromIndex(STORE_MEALS, 'byTimestamp');
    return all.filter(m => {
      const t = new Date(m.timestamp).getTime();
      return (!fromTs || t >= fromTs) && (!toTs || t <= toTs);
    });
  }

  async function listAllMeals() {
    const db = await getDB();
    return db.getAllFromIndex(STORE_MEALS, 'byTimestamp');
  }

  async function getMeal(id) {
    const db = await getDB();
    return db.get(STORE_MEALS, id);
  }

  // ------- 图片 -------
  async function saveImageBlob(blob) {
    const id = 'img-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8);
    const db = await getDB();
    await db.put(STORE_IMAGES, { id, blob });
    return id;
  }

  async function getImageBlob(id) {
    const db = await getDB();
    const rec = await db.get(STORE_IMAGES, id);
    return rec ? rec.blob : null;
  }

  // ------- 导出 / 清空 -------
  async function exportAll() {
    const profile = getProfile();
    const apiKeys = getApiKeys();
    const meals = await listAllMeals();
    return { exportedAt: new Date().toISOString(), profile, apiKeys: stripKeys(apiKeys), meals };
  }
  function stripKeys(k) {
    // 导出时不带 API Key
    return { ...k, gemini: '', deepseek: '' };
  }

  async function clearAll() {
    const db = await getDB();
    await db.clear(STORE_MEALS);
    await db.clear(STORE_IMAGES);
  }

  // ------- helpers -------
  function uuid() {
    // 简易 uuid（不要求强随机）
    return 'm-' + Date.now() + '-' + Math.random().toString(36).slice(2, 10);
  }

  /** 计算 Blob 的 SHA-256（hex 字符串），用于图片去重 */
  async function hashBlob(blob) {
    if (!crypto || !crypto.subtle) return null;
    const buf = await blob.arrayBuffer();
    const h = await crypto.subtle.digest('SHA-256', buf);
    return Array.from(new Uint8Array(h))
      .map(b => b.toString(16).padStart(2, '0')).join('');
  }

  /** 把一组 meals 抽出去重键：sourceFile + imageHash */
  function buildDedupeKeys(meals) {
    const sources = new Set();
    const hashes = new Set();
    meals.forEach(m => {
      if (m.sourceFile) sources.add(m.sourceFile);
      if (m.imageHash) hashes.add(m.imageHash);
    });
    return { sources, hashes };
  }

  return {
    getProfile, setProfile, clearProfile,
    getApiKeys, setApiKeys,
    saveMeal, deleteMeal, listMeals, listAllMeals, getMeal,
    saveImageBlob, getImageBlob,
    exportAll, clearAll,
    uuid, hashBlob, buildDedupeKeys,
  };
})();
