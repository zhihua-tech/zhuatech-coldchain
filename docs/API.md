# API 摘要

管理接口使用 `x-api-key`，传感器网关入口可使用 `x-device-token`。

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| GET | `/api/dashboard` | 冷链运营驾驶舱 |
| POST | `/api/assets` | 登记冷库、车辆或冷箱 |
| POST | `/api/sensors` | 接入传感器 |
| POST | `/api/shipments` | 创建运输批次 |
| POST | `/api/shipments/{id}/start` | 启运 |
| POST | `/api/sensors/{id}/telemetry` | 上报遥测，`eventId`去重 |
| POST | `/api/shipments/{id}/route-events` | 记录路线事件 |
| POST | `/api/alarms/{id}/acknowledge` | 告警签收 |
| POST | `/api/alarms/{id}/resolve` | 告警关闭 |
| POST | `/api/shipments/{id}/deliver` | 电子签收 |
| GET | `/api/shipments/{id}/report` | 合规报告 |

遥测批量接入、MQTT和时序查询可在设备接入层扩展，不改变领域规则。
