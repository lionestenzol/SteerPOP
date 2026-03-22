/**
 * SteerPop Gesture Database — IndexedDB persistence for gesture traces.
 * Adapter-side only — never imported by the engine.
 *
 * Stores normalized commit-vector traces per word for vector-based matching.
 * Each word can have up to MAX_TRACES_PER_WORD traces (FIFO eviction).
 * Global cap of MAX_WORDS enforced via LRU eviction.
 *
 * @module gesture-db
 */

const MAX_TRACES_PER_WORD = 10;
const MAX_WORDS = 500;

export class GestureDB {

  constructor(dbName = 'steerpop-gestures', version = 1) {
    this._dbName = dbName;
    this._version = version;
    this._db = null;
  }

  async open() {
    if (this._db) return this._db;

    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this._dbName, this._version);

      request.onupgradeneeded = (event) => {
        const db = event.target.result;
        if (!db.objectStoreNames.contains('traces')) {
          db.createObjectStore('traces', { keyPath: 'word' });
        }
      };

      request.onsuccess = (event) => {
        this._db = event.target.result;
        resolve(this._db);
      };

      request.onerror = (event) => {
        reject(event.target.error);
      };
    });
  }

  /**
   * Save a gesture trace for a word.
   * Filters: word must be >= 3 chars, commitVectors must have >= 2 entries.
   * Caps at MAX_TRACES_PER_WORD per word (FIFO). Enforces MAX_WORDS globally (LRU).
   *
   * @param {string} word - the typed word (lowercase)
   * @param {Array<{x,y}>} commitVectors - normalized commit vectors (canonical trace)
   * @param {Array<{x,y}>|null} rawVectors - normalized raw displacement vectors (optional)
   * @param {boolean} wasAccepted - true if user accepted a word suggestion
   */
  async saveTrace(word, commitVectors, rawVectors = null, wasAccepted = false) {
    if (!this._db) await this.open();
    if (!word || word.length < 3) return;
    if (!commitVectors || commitVectors.length < 2) return;

    const tx = this._db.transaction('traces', 'readwrite');
    const store = tx.objectStore('traces');

    const existing = await this._getRecord(store, word);
    const now = Date.now();

    if (existing) {
      // Append trace, enforce FIFO cap
      existing.traces.push({
        commitVectors,
        rawVectors,
        timestamp: now,
        wasAccepted,
      });
      if (existing.traces.length > MAX_TRACES_PER_WORD) {
        existing.traces = existing.traces.slice(-MAX_TRACES_PER_WORD);
      }
      existing.lastUsed = now;
      if (wasAccepted) existing.usageCount++;
      store.put(existing);
    } else {
      // New word — check global cap first
      const wordCount = await this._countRecords(store);
      if (wordCount >= MAX_WORDS) {
        await this._evictLRU(store);
      }
      store.put({
        word,
        lastUsed: now,
        usageCount: wasAccepted ? 1 : 0,
        traces: [{
          commitVectors,
          rawVectors,
          timestamp: now,
          wasAccepted,
        }],
      });
    }

    return new Promise((resolve, reject) => {
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
  }

  /**
   * Get all stored traces (for feeding to engine matching).
   * @returns {Array<{word, traces, usageCount}>}
   */
  async getAllTraces() {
    if (!this._db) await this.open();

    return new Promise((resolve, reject) => {
      const tx = this._db.transaction('traces', 'readonly');
      const store = tx.objectStore('traces');
      const request = store.getAll();
      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Get word count in the database.
   * @returns {number}
   */
  async getWordCount() {
    if (!this._db) await this.open();

    return new Promise((resolve, reject) => {
      const tx = this._db.transaction('traces', 'readonly');
      const store = tx.objectStore('traces');
      const request = store.count();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Delete all stored gesture data.
   */
  async clearAll() {
    if (!this._db) await this.open();

    return new Promise((resolve, reject) => {
      const tx = this._db.transaction('traces', 'readwrite');
      const store = tx.objectStore('traces');
      const request = store.clear();
      request.onsuccess = resolve;
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Export all data as a JSON-serializable object.
   * @returns {Object}
   */
  async exportData() {
    const traces = await this.getAllTraces();
    return {
      version: 1,
      exportedAt: new Date().toISOString(),
      words: traces,
    };
  }

  /**
   * Import data from a previously exported JSON object.
   * Replaces all existing data.
   * @param {Object} data - exported data object
   */
  async importData(data) {
    if (!this._db) await this.open();
    if (!data || !data.words) return;

    await this.clearAll();

    const tx = this._db.transaction('traces', 'readwrite');
    const store = tx.objectStore('traces');
    for (const entry of data.words) {
      store.put(entry);
    }

    return new Promise((resolve, reject) => {
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
  }

  // ── Private helpers ──────────────────────────────────────

  _getRecord(store, word) {
    return new Promise((resolve, reject) => {
      const request = store.get(word);
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error);
    });
  }

  _countRecords(store) {
    return new Promise((resolve, reject) => {
      const request = store.count();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async _evictLRU(store) {
    // Find the word with the oldest lastUsed timestamp and delete it
    return new Promise((resolve, reject) => {
      const request = store.openCursor();
      let oldestKey = null;
      let oldestTime = Infinity;

      request.onsuccess = (event) => {
        const cursor = event.target.result;
        if (cursor) {
          const entry = cursor.value;
          if (entry.lastUsed < oldestTime) {
            oldestTime = entry.lastUsed;
            oldestKey = entry.word;
          }
          cursor.continue();
        } else {
          // Done iterating — delete the oldest
          if (oldestKey !== null) {
            const delReq = store.delete(oldestKey);
            delReq.onsuccess = resolve;
            delReq.onerror = () => reject(delReq.error);
          } else {
            resolve();
          }
        }
      };
      request.onerror = () => reject(request.error);
    });
  }
}
