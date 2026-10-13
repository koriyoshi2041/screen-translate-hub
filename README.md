# screen-translate-hub

screen-translate-hub 是一个自部署的屏幕翻译与 AI 平台。Windows 桌面端负责截图、划词、持续屏幕采集和本机显示，Docker 后台负责账号、设备连接、跨设备中转和服务器侧处理，手机与电脑浏览器负责观看经过翻译或 AI 加工的画面，以及与 AI 对话。

平台的主线场景是持续屏幕翻译：用户在 Windows 上选定窗口或区域，平台持续识别画面文字，并把译文叠加在原文位置，同时在本机和网页上展示。截图翻译、划词翻译、划词问 AI 和图片问 AI 共用同一套处理能力。

## 当前阶段

项目处于需求整理阶段，仓库中只有需求文档，没有代码。需求确定后再进入架构设计与正式规格说明（specification，下文简称 spec）。

## 文档索引

| 文档 | 内容 |
| --- | --- |
| [术语表](docs/requirements/00-terms.md) | 全部需求文档统一使用的术语及其含义 |
| [产品需求](docs/requirements/01-product.md) | 产品定位、部署形态、客户端、功能入口、展示方式、AI 交互、多语言、历史记录、硬件要求 |
| [工作流](docs/requirements/02-workflow.md) | 工作流与入口的绑定、默认模板、节点编辑规则、执行位置、跨设备数据流向 |
| [OCR 与竞速翻译](docs/requirements/03-ocr-and-translation-race.md) | OCR 引擎选择、识别结果归一化、多翻译源竞速的显示与替换规则 |
| [运行与生命周期](docs/requirements/04-run-lifecycle.md) | 运行、批次、竞速和请求的生命周期，持续屏幕的处理节奏，超时、重试、停止、断连与配置变更 |
| [账号、设备与共享](docs/requirements/05-accounts-devices-sharing.md) | 主人账号、登录方式、Windows 服务开放、屏幕共享与观看规则 |
| [待定事项](docs/requirements/open-questions.md) | 已识别但尚未确定的问题 |

## 开发原则

平台尽可能复用现成开源项目，复用单位包括独立的库、可提取的模块和具体代码，不要求整体照搬某个完整软件。

平台从第一版起预留多语言支持。界面语言、OCR 识别语言和翻译语言分别配置，新增语言不需要改动处理流程。

## 许可

本项目采用 GNU Affero 通用公共许可证第 3 版（GNU Affero General Public License v3.0，AGPL-3.0）与商业许可双授权。

按 AGPL-3.0 使用时，修改后的版本以网络服务形式提供给他人，也必须向这些用户公开对应的完整源代码。许可证全文见 [LICENSE](LICENSE)。

不希望承担 AGPL-3.0 义务的商业使用，需要向仓库所有者另行取得商业许可。
