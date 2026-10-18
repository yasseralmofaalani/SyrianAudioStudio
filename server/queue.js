/**
 * طابور معالجة متزامن بحد قابل للضبط
 */

export class TaskQueue {
  constructor({ concurrency = 2 } = {}) {
    this.concurrency = Math.max(1, Number(concurrency) || 2);
    this.pending = [];
    this.active = 0;
    this.cancelled = new Set();
  }

  setConcurrency(n) {
    this.concurrency = Math.max(1, Math.min(8, Number(n) || 2));
    this._pump();
  }

  cancel(jobId) {
    this.cancelled.add(jobId);
    this.pending = this.pending.filter((t) => t.jobId !== jobId);
  }

  isCancelled(jobId) {
    return this.cancelled.has(jobId);
  }

  clearCancel(jobId) {
    this.cancelled.delete(jobId);
  }

  add(jobId, taskFn) {
    return new Promise((resolve, reject) => {
      if (this.cancelled.has(jobId)) {
        reject(Object.assign(new Error('تم إلغاء العملية'), { code: 'CANCELLED' }));
        return;
      }
      this.pending.push({ jobId, taskFn, resolve, reject });
      this._pump();
    });
  }

  _pump() {
    while (this.active < this.concurrency && this.pending.length) {
      const item = this.pending.shift();
      if (this.cancelled.has(item.jobId)) {
        item.reject(Object.assign(new Error('تم إلغاء العملية'), { code: 'CANCELLED' }));
        continue;
      }
      this.active += 1;
      Promise.resolve()
        .then(() => item.taskFn())
        .then(item.resolve, item.reject)
        .finally(() => {
          this.active -= 1;
          this._pump();
        });
    }
  }

  stats() {
    return {
      concurrency: this.concurrency,
      pending: this.pending.length,
      active: this.active,
    };
  }
}
