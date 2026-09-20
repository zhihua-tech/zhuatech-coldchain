import test from 'node:test';
import assert from 'node:assert/strict';
import { ColdChainService } from '../src/domain.js';

function fixture() {
  const service = new ColdChainService();
  const asset = service.registerAsset({ code: 'T1', name: '冷藏车', organization: '华东配送' });
  const sensor = service.registerSensor({ code: 'S1', assetId: asset.id });
  const shipment = service.createShipment({ batchNo: 'B1', goodsName: '冷藏药品', assetId: asset.id, sensorIds: [sensor.id], origin: '上海', destination: '苏州', carrier: '承运商', thresholds: { minTemperature: 2, maxTemperature: 8, maxHumidity: 75 } });
  service.startShipment(shipment.id);
  return { service, asset, sensor, shipment };
}

test('正常遥测被记录且相同事件自动去重', () => {
  const { service, sensor } = fixture();
  const input = { eventId: 'E1', temperature: 5, humidity: 60 };
  service.ingestTelemetry(sensor.id, input);
  service.ingestTelemetry(sensor.id, input);
  assert.equal(service.telemetry.length, 1);
  assert.equal(service.alarms.size, 0);
});

test('温度超限触发严重告警并支持闭环处理', () => {
  const { service, sensor } = fixture();
  service.ingestTelemetry(sensor.id, { eventId: 'E2', temperature: 10, humidity: 60 });
  const alarm = [...service.alarms.values()][0];
  assert.equal(alarm.severity, 'critical');
  service.acknowledgeAlarm(alarm.id, '值班调度');
  const resolved = service.resolveAlarm(alarm.id, { cause: '冷机短暂停机', action: '重启冷机并复核' });
  assert.equal(resolved.status, 'resolved');
});

test('未关闭严重告警阻止签收，关闭后生成合规报告', () => {
  const { service, sensor, shipment } = fixture();
  service.ingestTelemetry(sensor.id, { eventId: 'E3', temperature: 9, humidity: 60 });
  assert.throws(() => service.deliver(shipment.id, { receiver: '医院', signature: 'sig' }), /严重告警/);
  const alarm = [...service.alarms.values()][0];
  service.resolveAlarm(alarm.id, { cause: '开门卸货', action: '确认货品温度合格' });
  service.deliver(shipment.id, { receiver: '医院', signature: 'sig' });
  const report = service.complianceReport(shipment.id);
  assert.equal(report.sampleCount, 1);
  assert.equal(report.resolvedRate, 100);
});
