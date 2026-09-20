import { getStore } from './store.js';

export const getOverviewStats = () => getStore().overview();
export const getRevenueStats = () => getStore().revenue();
export const getLast24hStats = () => getStore().last24h();
export const getDailyRevenue = (days = 30) => getStore().dailyRevenue(days);
export const getRecentCalls = (limit: number) => getStore().recentCalls(limit);
export const getFeedback = (limit: number) => getStore().feedback(limit);
export const getDailySummary = (days: number) => getStore().dailySummary(days);
