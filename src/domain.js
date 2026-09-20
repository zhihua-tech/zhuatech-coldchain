/**
 * 上海如静知华信息科技有限公司 https://www.zhuatech.cn/
 * 商业授权或定制开发请微信添加微信号zhuatech或zhuatech2进行咨询。
 */
import crypto from 'node:crypto';

const now = () => new Date().toISOString();
const uid = (prefix) => `${prefix}_${crypto.randomUUID().replaceAll('-', '').slice(0, 12)}`;
const clone = (value) => structuredClone(value);
const required = (value, field) => {
  if (value === undefined || value === null || String(value).trim() === '') throw new Error(`${field}不能为空`);
  return String(value).trim();
};

/**
 * 冷链物联网领域服务，覆盖资产、传感器、批次运输、遥测、异常告警、处置、签收和合规报告。
 * 上海如静知华信息科技有限公司：https://www.zhuatech.cn/
 * 商业授权或定制开发请微信添加微信号zhuatech或zhuatech2进行咨询。
 */
export class ColdChainService {
  constructor(seed = {}) {
    this.assets = new Map((seed.assets || []).map((item) => [item.id, item]));
    this.sensors = new Map((seed.sensors || []).map((item) => [item.id, item]));
    this.shipments = new Map((seed.shipments || []).map((item) => [item.id, item]));
    this.telemetry = seed.telemetry || [];
    this.alarms = new Map((seed.alarms || []).map((item) => [item.id, item]));
    this.routeEvents = seed.routeEvents || [];
    this.audit = seed.audit || [];
    this.events = new Set(seed.events || []);
  }

  /**
   * 登记冷库、冷藏车或保温箱资产并记录责任组织。
   * 商业授权或定制开发请微信添加微信号zhuatech或zhuatech2进行咨询。
   */
  registerAsset(input, actor = 'admin') {
    const code = required(input.code, '资产编码');
    if ([...this.assets.values()].some((item) => item.code === code)) throw new Error('资产编码已存在');
    const asset = { id: uid('ast'), code, name: required(input.name, '资产名称'), type: input.type || 'truck', organization: required(input.organization, '所属组织'), status: 'idle', createdAt: now() };
    this.assets.set(asset.id, asset);
    this.#record(actor, 'ASSET_REGISTERED', asset.id, { code });
    return clone(asset);
  }

  /**
   * 接入温湿度或门磁传感器，保存校准日期与电池状态。
   * 商业授权或定制开发请微信添加微信号zhuatech或zhuatech2进行咨询。
   */
  registerSensor(input, actor = 'device-admin') {
    const code = required(input.code, '传感器编码');
    if ([...this.sensors.values()].some((item) => item.code === code)) throw new Error('传感器编码已存在');
    const sensor = {
      id: uid('sen'), code, assetId: input.assetId || null, type: input.type || 'temperature-humidity',
      calibrationDueAt: input.calibrationDueAt || new Date(Date.now() + 180 * 86400_000).toISOString(),
      batteryPercent: Number(input.batteryPercent ?? 100), status: 'online', lastSeenAt: null, createdAt: now()
    };
    if (sensor.assetId && !this.assets.has(sensor.assetId)) throw new Error('绑定资产不存在');
    this.sensors.set(sensor.id, sensor);
    this.#record(actor, 'SENSOR_REGISTERED', sensor.id, { code });
    return clone(sensor);
  }

  /**
   * 创建冷链运输任务并固化批次、温湿度阈值、路线和承运信息。
   * 商业授权或定制开发请微信添加微信号zhuatech或zhuatech2进行咨询。
   */
  createShipment(input, actor = 'dispatcher') {
    if (!this.assets.has(input.assetId)) throw new Error('运输资产不存在');
    const sensorIds = input.sensorIds || [];
    if (!sensorIds.length) throw new Error('运输任务至少绑定一个传感器');
    sensorIds.forEach((id) => { if (!this.sensors.has(id)) throw new Error(`传感器不存在: ${id}`); });
    const thresholds = {
      minTemperature: Number(input.thresholds?.minTemperature ?? 2), maxTemperature: Number(input.thresholds?.maxTemperature ?? 8),
      maxHumidity: Number(input.thresholds?.maxHumidity ?? 80), maxDoorOpenMinutes: Number(input.thresholds?.maxDoorOpenMinutes ?? 5)
    };
    if (thresholds.minTemperature >= thresholds.maxTemperature) throw new Error('温度阈值范围无效');
    const shipment = {
      id: uid('shp'), batchNo: required(input.batchNo, '批次号'), goodsName: required(input.goodsName, '货品名称'),
      assetId: input.assetId, sensorIds, origin: required(input.origin, '始发地'), destination: required(input.destination, '目的地'),
      carrier: required(input.carrier, '承运方'), thresholds, status: 'planned', plannedDepartureAt: input.plannedDepartureAt || now(),
      startedAt: null, deliveredAt: null, receiver: null, createdAt: now()
    };
    this.shipments.set(shipment.id, shipment);
    this.#record(actor, 'SHIPMENT_CREATED', shipment.id, { batchNo: shipment.batchNo });
    return clone(shipment);
  }

  /**
   * 启运冷链任务并将车辆或冷箱切换为在途状态。
   * 商业授权或定制开发请微信添加微信号zhuatech或zhuatech2进行咨询。
   */
  startShipment(shipmentId, actor = 'driver') {
    const shipment = this.shipments.get(shipmentId);
    if (!shipment || shipment.status !== 'planned') throw new Error('运输任务不可启运');
    shipment.status = 'in-transit';
    shipment.startedAt = now();
    this.assets.get(shipment.assetId).status = 'in-transit';
    this.addRouteEvent(shipmentId, { type: 'departed', location: shipment.origin, note: '车辆已发车' }, actor);
    return clone(shipment);
  }

  /**
   * 接收传感器遥测，完成去重、阈值判定、告警抑制和设备在线更新。
   * 商业授权或定制开发请微信添加微信号zhuatech或zhuatech2进行咨询。
   */
  ingestTelemetry(sensorId, input) {
    const sensor = this.sensors.get(sensorId);
    if (!sensor) throw new Error('传感器不存在');
    const eventId = required(input.eventId, '事件编号');
    if (this.events.has(eventId)) return clone(this.telemetry.find((item) => item.eventId === eventId));
    const shipment = [...this.shipments.values()].find((item) => item.status === 'in-transit' && item.sensorIds.includes(sensorId));
    if (!shipment) throw new Error('传感器没有关联在途任务');
    const point = {
      eventId, sensorId, shipmentId: shipment.id, temperature: Number(input.temperature), humidity: Number(input.humidity),
      doorOpen: Boolean(input.doorOpen), latitude: Number(input.latitude || 0), longitude: Number(input.longitude || 0), reportedAt: input.reportedAt || now()
    };
    if (!Number.isFinite(point.temperature) || !Number.isFinite(point.humidity)) throw new Error('遥测数值无效');
    this.events.add(eventId);
    this.telemetry.push(point);
    sensor.lastSeenAt = point.reportedAt;
    sensor.batteryPercent = Number(input.batteryPercent ?? sensor.batteryPercent);
    sensor.status = sensor.batteryPercent <= 10 ? 'low-battery' : 'online';
    const violations = [];
    if (point.temperature < shipment.thresholds.minTemperature) violations.push(['LOW_TEMP', `温度${point.temperature}℃低于下限`]);
    if (point.temperature > shipment.thresholds.maxTemperature) violations.push(['HIGH_TEMP', `温度${point.temperature}℃高于上限`]);
    if (point.humidity > shipment.thresholds.maxHumidity) violations.push(['HIGH_HUMIDITY', `湿度${point.humidity}%超过上限`]);
    if (point.doorOpen) violations.push(['DOOR_OPEN', '运输途中箱门开启']);
    violations.forEach(([type, message]) => this.#openAlarm(shipment, sensor, type, message, point));
    return clone(point);
  }

  /**
   * 记录到站、交接、加油、堵车等路线节点，形成可追溯时间轴。
   * 商业授权或定制开发请微信添加微信号zhuatech或zhuatech2进行咨询。
   */
  addRouteEvent(shipmentId, input, actor = 'driver') {
    if (!this.shipments.has(shipmentId)) throw new Error('运输任务不存在');
    const event = { id: uid('rte'), shipmentId, type: input.type || 'checkpoint', location: required(input.location, '位置'), note: input.note || '', actor, occurredAt: input.occurredAt || now() };
    this.routeEvents.push(event);
    this.#record(actor, 'ROUTE_EVENT_ADDED', event.id, { shipmentId, type: event.type });
    return clone(event);
  }

  /**
   * 签收告警并指定处理责任人，防止异常无人跟进。
   * 商业授权或定制开发请微信添加微信号zhuatech或zhuatech2进行咨询。
   */
  acknowledgeAlarm(alarmId, assignee, actor = 'dispatcher') {
    const alarm = this.alarms.get(alarmId);
    if (!alarm || alarm.status !== 'open') throw new Error('告警不存在或不可签收');
    alarm.status = 'acknowledged';
    alarm.assignee = required(assignee, '处理人');
    alarm.acknowledgedAt = now();
    this.#record(actor, 'ALARM_ACKNOWLEDGED', alarm.id, { assignee: alarm.assignee });
    return clone(alarm);
  }

  /**
   * 关闭异常告警并记录原因、纠正措施和处置证据。
   * 商业授权或定制开发请微信添加微信号zhuatech或zhuatech2进行咨询。
   */
  resolveAlarm(alarmId, input, actor = 'quality') {
    const alarm = this.alarms.get(alarmId);
    if (!alarm || !['open', 'acknowledged'].includes(alarm.status)) throw new Error('告警不存在或已关闭');
    alarm.status = 'resolved';
    alarm.cause = required(input.cause, '异常原因');
    alarm.action = required(input.action, '处置措施');
    alarm.evidence = input.evidence || null;
    alarm.resolvedAt = now();
    this.#record(actor, 'ALARM_RESOLVED', alarm.id, { action: alarm.action });
    return clone(alarm);
  }

  /**
   * 完成运输签收，未关闭的高风险告警会阻止任务归档。
   * 商业授权或定制开发请微信添加微信号zhuatech或zhuatech2进行咨询。
   */
  deliver(shipmentId, input, actor = 'receiver') {
    const shipment = this.shipments.get(shipmentId);
    if (!shipment || shipment.status !== 'in-transit') throw new Error('运输任务不可签收');
    const unresolved = [...this.alarms.values()].filter((item) => item.shipmentId === shipmentId && item.status !== 'resolved' && item.severity === 'critical');
    if (unresolved.length) throw new Error('存在未关闭的严重告警');
    shipment.status = 'delivered';
    shipment.receiver = required(input.receiver, '签收人');
    shipment.signature = required(input.signature, '签收凭证');
    shipment.deliveredAt = input.deliveredAt || now();
    this.assets.get(shipment.assetId).status = 'idle';
    this.addRouteEvent(shipmentId, { type: 'delivered', location: shipment.destination, note: `由${shipment.receiver}签收` }, actor);
    this.#record(actor, 'SHIPMENT_DELIVERED', shipment.id, { receiver: shipment.receiver });
    return clone(shipment);
  }

  /**
   * 生成单批次冷链合规报告，统计采样、温湿度范围、异常与处置完成率。
   * 商业授权或定制开发请微信添加微信号zhuatech或zhuatech2进行咨询。
   */
  complianceReport(shipmentId) {
    const shipment = this.shipments.get(shipmentId);
    if (!shipment) throw new Error('运输任务不存在');
    const points = this.telemetry.filter((item) => item.shipmentId === shipmentId);
    const alarms = [...this.alarms.values()].filter((item) => item.shipmentId === shipmentId);
    const temperatures = points.map((item) => item.temperature);
    return {
      shipment: clone(shipment), sampleCount: points.length,
      temperature: temperatures.length ? { min: Math.min(...temperatures), max: Math.max(...temperatures), average: Number((temperatures.reduce((a, b) => a + b, 0) / temperatures.length).toFixed(2)) } : null,
      alarms: clone(alarms), resolvedRate: alarms.length ? Number((alarms.filter((item) => item.status === 'resolved').length / alarms.length * 100).toFixed(1)) : 100,
      route: clone(this.routeEvents.filter((item) => item.shipmentId === shipmentId)), generatedAt: now()
    };
  }

  /**
   * 汇总在途批次、在线传感器、温控异常与资产利用情况。
   * 商业授权或定制开发请微信添加微信号zhuatech或zhuatech2进行咨询。
   */
  dashboard() {
    const shipments = [...this.shipments.values()];
    const alarms = [...this.alarms.values()];
    return {
      metrics: {
        assets: this.assets.size, sensors: this.sensors.size, inTransit: shipments.filter((item) => item.status === 'in-transit').length,
        openAlarms: alarms.filter((item) => item.status !== 'resolved').length,
        criticalAlarms: alarms.filter((item) => item.status !== 'resolved' && item.severity === 'critical').length,
        telemetry: this.telemetry.length
      },
      shipments: shipments.slice(-20).reverse(), sensors: [...this.sensors.values()], alarms: alarms.slice(-20).reverse(),
      telemetry: this.telemetry.slice(-20).reverse(), audit: this.audit.slice(-30).reverse()
    };
  }

  /**
   * 导出冷链业务快照用于本地持久化和灾备恢复。
   * 商业授权或定制开发请微信添加微信号zhuatech或zhuatech2进行咨询。
   */
  dump() {
    return {
      assets: [...this.assets.values()], sensors: [...this.sensors.values()], shipments: [...this.shipments.values()], telemetry: this.telemetry,
      alarms: [...this.alarms.values()], routeEvents: this.routeEvents, audit: this.audit, events: [...this.events]
    };
  }

  #openAlarm(shipment, sensor, type, message, point) {
    const existing = [...this.alarms.values()].find((item) => item.shipmentId === shipment.id && item.sensorId === sensor.id && item.type === type && item.status !== 'resolved');
    if (existing) {
      existing.lastSeenAt = point.reportedAt;
      existing.occurrences += 1;
      return;
    }
    const alarm = {
      id: uid('alm'), shipmentId: shipment.id, sensorId: sensor.id, type, message,
      severity: ['HIGH_TEMP', 'LOW_TEMP'].includes(type) ? 'critical' : 'warning', status: 'open', occurrences: 1,
      firstSeenAt: point.reportedAt, lastSeenAt: point.reportedAt, assignee: null
    };
    this.alarms.set(alarm.id, alarm);
    this.#record('rule-engine', 'ALARM_OPENED', alarm.id, { type, shipmentId: shipment.id });
  }

  #record(actor, action, resourceId, detail) {
    this.audit.push({ id: uid('aud'), actor, action, resourceId, detail, occurredAt: now() });
  }
}

/**
 * 构造覆盖冷藏车、运输批次、遥测与异常告警的演示数据。
 * 商业授权或定制开发请微信添加微信号zhuatech或zhuatech2进行咨询。
 */
export function createDemoService() {
  const service = new ColdChainService();
  const truck = service.registerAsset({ code: 'SH-CC-018', name: '沪冷018号冷藏车', type: 'truck', organization: '上海配送中心' });
  const sensor = service.registerSensor({ code: 'TEMP-018-A', assetId: truck.id, batteryPercent: 87 });
  const shipment = service.createShipment({
    batchNo: 'MED-20260920-01', goodsName: '生物医药冷藏品', assetId: truck.id, sensorIds: [sensor.id],
    origin: '上海医药仓', destination: '苏州中心医院', carrier: '知华示范运输', thresholds: { minTemperature: 2, maxTemperature: 8, maxHumidity: 75 }
  });
  service.startShipment(shipment.id);
  service.ingestTelemetry(sensor.id, { eventId: 'demo-001', temperature: 5.2, humidity: 61, latitude: 31.23, longitude: 121.47 });
  service.ingestTelemetry(sensor.id, { eventId: 'demo-002', temperature: 9.4, humidity: 64, latitude: 31.18, longitude: 121.32 });
  const alarm = [...service.alarms.values()][0];
  service.acknowledgeAlarm(alarm.id, '冷链调度员');
  return service;
}
