// ============================================
// VoiceCore — Analytics Engine
// Real-time call analytics & KPI tracking
// ============================================

const { Logger } = require('../utils/logger');
const log = new Logger('ANALYTICS');

class AnalyticsEngine {
  constructor() {
    this.realtimeMetrics = {
      activeCalls: 0,
      totalCalls: 0,
      totalMinutes: 0,
      totalCost: 0,
      avgLatency: { stt: 0, llm: 0, tts: 0 },
    };
    this.callLog = [];         // Last N calls for quick access
    this.hourlyStats = {};     // { 'YYYY-MM-DD-HH': { calls, minutes, cost } }
    this.providerStats = {};   // { provider: { calls, avgLatency, errors } }
    this.assistantStats = {};  // { assistantId: { calls, avgDuration, bookings } }
    this.maxLogSize = 1000;
  }

  /**
   * Record a completed call
   */
  recordCall(callData) {
    const duration = callData.duration || 0;
    const minutes = duration / 60000;
    const cost = callData.cost?.total || 0;

    // Update totals
    this.realtimeMetrics.totalCalls++;
    this.realtimeMetrics.totalMinutes += minutes;
    this.realtimeMetrics.totalCost += cost;

    // Record to log
    const entry = {
      callId: callData.callId,
      assistantId: callData.assistantId,
      callerNumber: callData.callerNumber,
      direction: callData.direction,
      duration: Math.round(duration / 1000),
      turnCount: callData.turnCount || 0,
      cost: Math.round(cost * 10000) / 10000,
      startedAt: callData.startedAt,
      endedAt: callData.endedAt,
      avgLatency: callData.metrics?.avgTurnTime || 0,
      sentiment: callData.sentiment || 'neutral',
      outcome: callData.outcome || 'completed',
      toolsUsed: callData.metrics?.toolCalls || 0,
    };
    this.callLog.unshift(entry);
    if (this.callLog.length > this.maxLogSize) this.callLog.pop();

    // Hourly stats
    const hour = new Date(callData.startedAt || Date.now()).toISOString().substring(0, 13);
    if (!this.hourlyStats[hour]) this.hourlyStats[hour] = { calls: 0, minutes: 0, cost: 0 };
    this.hourlyStats[hour].calls++;
    this.hourlyStats[hour].minutes += minutes;
    this.hourlyStats[hour].cost += cost;

    // Provider stats
    this._updateProviderStats('stt', callData.sttProvider, callData.metrics);
    this._updateProviderStats('llm', callData.llmProvider, callData.metrics);
    this._updateProviderStats('tts', callData.ttsProvider, callData.metrics);

    // Assistant stats
    if (callData.assistantId) {
      if (!this.assistantStats[callData.assistantId]) {
        this.assistantStats[callData.assistantId] = {
          calls: 0, totalDuration: 0, totalCost: 0, bookings: 0, transfers: 0,
        };
      }
      const as = this.assistantStats[callData.assistantId];
      as.calls++;
      as.totalDuration += duration;
      as.totalCost += cost;
      if (callData.outcome === 'booked') as.bookings++;
    }

    log.metric(`Call recorded: ${callData.callId} — ${Math.round(minutes * 10) / 10}min, $${Math.round(cost * 10000) / 10000}`);
  }

  _updateProviderStats(type, provider, metrics) {
    if (!provider) return;
    const key = `${type}:${provider}`;
    if (!this.providerStats[key]) {
      this.providerStats[key] = { calls: 0, totalLatency: 0, errors: 0 };
    }
    this.providerStats[key].calls++;
    if (metrics?.[`${type}Latency`]) {
      this.providerStats[key].totalLatency += metrics[`${type}Latency`];
    }
  }

  /**
   * Get dashboard summary
   */
  getDashboard() {
    const now = new Date();
    const todayKey = now.toISOString().substring(0, 10);
    const thisMonthKey = now.toISOString().substring(0, 7);

    // Today's stats
    const todayStats = { calls: 0, minutes: 0, cost: 0 };
    for (const [hour, stats] of Object.entries(this.hourlyStats)) {
      if (hour.startsWith(todayKey)) {
        todayStats.calls += stats.calls;
        todayStats.minutes += stats.minutes;
        todayStats.cost += stats.cost;
      }
    }

    // This month's stats
    const monthStats = { calls: 0, minutes: 0, cost: 0 };
    for (const [hour, stats] of Object.entries(this.hourlyStats)) {
      if (hour.startsWith(thisMonthKey)) {
        monthStats.calls += stats.calls;
        monthStats.minutes += stats.minutes;
        monthStats.cost += stats.cost;
      }
    }

    return {
      realtime: {
        activeCalls: this.realtimeMetrics.activeCalls,
        totalCalls: this.realtimeMetrics.totalCalls,
        totalMinutes: Math.round(this.realtimeMetrics.totalMinutes * 100) / 100,
        totalCost: Math.round(this.realtimeMetrics.totalCost * 10000) / 10000,
      },
      today: {
        calls: todayStats.calls,
        minutes: Math.round(todayStats.minutes * 100) / 100,
        cost: Math.round(todayStats.cost * 10000) / 10000,
      },
      thisMonth: {
        calls: monthStats.calls,
        minutes: Math.round(monthStats.minutes * 100) / 100,
        cost: Math.round(monthStats.cost * 10000) / 10000,
      },
      recentCalls: this.callLog.slice(0, 20),
    };
  }

  /**
   * Get call heatmap (hourly call volume)
   */
  getHeatmap(days = 7) {
    const heatmap = {};
    const cutoff = new Date(Date.now() - days * 86400000).toISOString().substring(0, 10);

    for (const [hour, stats] of Object.entries(this.hourlyStats)) {
      if (hour >= cutoff) {
        const day = hour.substring(0, 10);
        const h = parseInt(hour.substring(11, 13));
        if (!heatmap[day]) heatmap[day] = new Array(24).fill(0);
        heatmap[day][h] = stats.calls;
      }
    }
    return heatmap;
  }

  /**
   * Get conversion funnel
   */
  getFunnel(days = 30) {
    const cutoff = Date.now() - days * 86400000;
    const recent = this.callLog.filter(c => new Date(c.startedAt).getTime() > cutoff);

    const total = recent.length;
    const connected = recent.filter(c => c.duration > 5).length;
    const engaged = recent.filter(c => c.turnCount > 2).length;
    const toolsUsed = recent.filter(c => c.toolsUsed > 0).length;
    const booked = recent.filter(c => c.outcome === 'booked').length;

    return {
      total,
      connected: { count: connected, rate: total > 0 ? Math.round(connected / total * 100) : 0 },
      engaged: { count: engaged, rate: total > 0 ? Math.round(engaged / total * 100) : 0 },
      toolsUsed: { count: toolsUsed, rate: total > 0 ? Math.round(toolsUsed / total * 100) : 0 },
      booked: { count: booked, rate: total > 0 ? Math.round(booked / total * 100) : 0 },
    };
  }

  /**
   * Get per-assistant performance
   */
  getAssistantPerformance() {
    const result = {};
    for (const [id, stats] of Object.entries(this.assistantStats)) {
      result[id] = {
        calls: stats.calls,
        avgDuration: stats.calls > 0 ? Math.round(stats.totalDuration / stats.calls / 1000) : 0,
        totalCost: Math.round(stats.totalCost * 10000) / 10000,
        bookings: stats.bookings,
        conversionRate: stats.calls > 0 ? Math.round(stats.bookings / stats.calls * 100) : 0,
      };
    }
    return result;
  }

  /**
   * Get provider performance
   */
  getProviderPerformance() {
    const result = {};
    for (const [key, stats] of Object.entries(this.providerStats)) {
      result[key] = {
        calls: stats.calls,
        avgLatency: stats.calls > 0 ? Math.round(stats.totalLatency / stats.calls) : 0,
        errorRate: stats.calls > 0 ? Math.round(stats.errors / stats.calls * 100) : 0,
      };
    }
    return result;
  }

  // Active call tracking
  callStarted() { this.realtimeMetrics.activeCalls++; }
  callEnded() { this.realtimeMetrics.activeCalls = Math.max(0, this.realtimeMetrics.activeCalls - 1); }
}

// Singleton
let instance = null;
function getAnalytics() {
  if (!instance) instance = new AnalyticsEngine();
  return instance;
}

module.exports = { AnalyticsEngine, getAnalytics };
