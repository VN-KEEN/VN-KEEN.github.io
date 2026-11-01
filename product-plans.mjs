export const PLANS = Object.freeze({
  daily: Object.freeze({ id: 'daily', name: 'Gói Thuê 1 Ngày (24H)', amount: 20000, days: 1 }),
  weekly: Object.freeze({ id: 'weekly', name: 'Gói Thuê 7 Ngày', amount: 100000, days: 7 }),
  monthly: Object.freeze({ id: 'monthly', name: 'Gói Thuê 30 Ngày (1 Tháng)', amount: 300000, days: 30 }),
  quarterly: Object.freeze({ id: 'quarterly', name: 'Gói Thuê 90 Ngày', amount: 800000, days: 90 }),
  lifetime: Object.freeze({ id: 'lifetime', name: 'Gói Bản Quyền Vĩnh Viễn', amount: 2500000, days: null })
});

