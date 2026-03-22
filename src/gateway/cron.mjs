import { log } from '../utils/log.mjs';

export class CronManager {
  constructor(config, gateway) {
    this.config = config;
    this.gateway = gateway;
    this._jobs = new Map();
  }

  async start() {
    const jobs = this.config.cron ?? [];
    for (const job of jobs) {
      await this.add(job).catch(e => log.warn(`Cron job failed to start: ${e.message}`));
    }
  }

  stop() {
    for (const [id, job] of this._jobs) {
      clearInterval(job._interval);
    }
    this._jobs.clear();
  }

  async list() {
    return [...this._jobs.values()].map(j => ({ id: j.id, schedule: j.schedule, message: j.message, enabled: j.enabled }));
  }

  async add(params) {
    const { id = crypto.randomUUID(), schedule, message, sessionId = 'main', enabled = true } = params;
    if (!schedule || !message) throw new Error('Cron job requires schedule and message');

    // Simple interval parsing: "every 1h", "every 30m", "every 5s"
    const ms = parseCronSchedule(schedule);
    const interval = setInterval(async () => {
      log.info(`[cron] Running job: ${id}`);
      try {
        await this.gateway.agent.send({ sessionId, message, thinkingLevel: 'low' });
      } catch (e) {
        log.warn(`Cron job error: ${e.message}`);
      }
    }, ms);

    this._jobs.set(id, { id, schedule, message, sessionId, enabled, _interval: interval });
    log.info(`Cron job added: ${id} (${schedule})`);
    return { id, ok: true };
  }

  async remove(id) {
    const job = this._jobs.get(id);
    if (job) { clearInterval(job._interval); this._jobs.delete(id); }
    return { removed: id };
  }
}

function parseCronSchedule(schedule) {
  const match = schedule.match(/every\s+(\d+)(s|m|h|d)/i);
  if (!match) return 3600000; // default 1 hour
  const n = parseInt(match[1]);
  const unit = match[2].toLowerCase();
  const ms = { s: 1000, m: 60000, h: 3600000, d: 86400000 }[unit];
  return n * ms;
}
