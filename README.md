# TankMe

**A browser-based 3D team tank battle game — built with Blender-modeled vehicles, procedural PBR assets and a custom Three.js engine. / 一款浏览器 3D 团队坦克对战游戏——坦克由 Blender 建模，资产程序化生成，基于自研 Three.js 引擎。**

All assets (models, textures, audio, map) are original and generated in-project. No assets from any commercial game are used. Historical vehicles serve only as public-domain *design references*.
所有资产（模型、贴图、音效、地图）均为项目内原创生成，不使用任何商业游戏素材。历史车辆仅作为公有领域的*设计参考*。

---

## English

### 1. Project Overview / 项目介绍
TankMe is a fast, readable team deathmatch tank game running entirely in the browser. Two teams of AI-driven (and one player-driven) tanks fight on "Ironridge Crossing" — a tactically structured map with a central ridge, a walled village, industrial ruins and flanking routes.

### 2. Features / 功能
- 7v7 and 14v14 Team Deathmatch on one shared map
- 8 original vehicles in 4 classes with 3-level LOD GLB models
- 6-zone armor model (front/side/rear/turret/roof/tracks), penetration with distance falloff, impact-angle ricochets, critical hits, module damage (track/engine/gun)
- Armor indicator (LIKELY / POSSIBLE / UNLIKELY / NO CHANCE) computed from the same math as the simulation
- Supply drops: damage boost, defense boost, field repair, cloak field
- Role-based team AI (assault / flanker / sniper / support / defender) with A* pathing
- Procedural sky with drifting clouds, PMREM environment lighting, bloom + filmic grade post-processing
- Procedural audio (WebAudio synthesis) — no audio files
- Graphics presets Low / Medium / High, persistent settings, FPS counter

### 3. Gameplay / 玩法
Destroy enemy tanks to score for your team. Higher score when the 8-minute timer ends — or first to the score limit — wins. Destroyed tanks respawn after 6 seconds with 3 seconds of spawn protection.

### 4. Tank Classes / 坦克类型
| Class | Vehicles | Identity |
| --- | --- | --- |
| Light | KESTREL KL-1, JACKAL JL-3 | Fast scouts, flankers, low armor |
| Medium | BULWARK BM-4, VANGUARD VK-7 | Balanced main battle tanks |
| Heavy | IRONWOLF IH-8, COLOSSUS CS-9 | Thick armor, heavy guns, slow |
| Tank Destroyer | MAUL MH-5, LANCE LL-6 | Casemate guns, huge alpha, limited gun arc |

### 5. Tank References / 坦克设计参考
The vehicles are **original TankMe designs inspired by public historical references** (museum data and historical photographs — not game assets):

| TankMe vehicle | Historical reference | Visual characteristics borrowed |
| --- | --- | --- |
| KESTREL KL-1 | M551 Sheridan | Compact aluminum-look hull, forward turret, large gun, 5 road wheels |
| JACKAL JL-3 | Type 62 | Small cast turret, slim high-velocity gun, small silhouette |
| BULWARK BM-4 | M4 Sherman | Tall rounded hull, cast turret, WWII industrial language |
| VANGUARD VK-7 | M48 Patton | Long cast turret with bustle, commander cupola, bore extractor |
| IRONWOLF IH-8 | Tiger I | Boxy welded hull/turret, long cannon, double-baffle brake, wide tracks |
| COLOSSUS CS-9 | Maus | Super-heavy hull, enormous boxy turret, extreme mass |
| MAUL MH-5 | ISU-152 | Fixed casemate superstructure, massive frontal gun |
| LANCE LL-6 | AMX 50 Foch | Low post-war French casemate, very long gun |

Names, stats, textures, decals and models are TankMe originals. / 车辆命名、数据、贴图与模型均为 TankMe 原创。

### 6. Architecture / 项目架构
```
src/
├── config/      data-driven specs (tanks, map, powerups, match, quality, combat)
├── core/        Game loop, events bus, settings, input
├── render/      renderer, sky/lighting, procedural PBR textures
├── world/       analytic terrain, AABB physics, A* nav grid, map builder
├── tank/        TankAssetLibrary (GLB), procedural fallback, tank entity
├── combat/      projectile pool, armor math (shared sim + UI)
├── controllers/ PlayerController, role-based AIController
├── effects/     GPU particle pools, debris, damage numbers, camera trauma
├── powerup/     supply drop system
├── audio/       WebAudio synthesis engine
├── match/       teams, scoring, respawns, objectives
└── ui/          HUD, menus, minimap (DOM overlay)
assets/tanks/    Blender build scripts + source exports (per-vehicle folders)
```

### 7. Technology Stack / 技术栈
Vite · TypeScript (strict) · Three.js (WebGL2) · Blender 4.5 LTS + Python (asset pipeline) · WebAudio · DOM/CSS UI

### 8. Installation / 安装方法
```bash
npm install
```
Optional (only to rebuild tank assets): install Blender 4.5+ and note its path.

### 9. Development / 开发方法
```bash
npm run dev         # dev server → http://localhost:5173
npm run typecheck   # strict TypeScript check
npm run build       # production bundle → dist/
npm run preview     # serve the production build
```

### 10. Running the Game / 运行方法
Open http://localhost:5173 → **BATTLE** → pick a mode and vehicle → **DEPLOY**.
WASD drives, mouse aims (turret follows), LMB fires, RMB zooms, Space brakes, Esc pauses.

### 11. Blender Workflow / Blender 建模流程
1. Historical reference → 2. design study → 3. parametric Blender build → 4. PBR materials → 5. rig pivots → 6. LOD → 7. GLB export → 8. Three.js integration → 9. in-game visual pass.

`assets/tanks/_kit/` contains the whole pipeline:
- `tank_kit.py` — parametric construction kit (lofted hulls, cast/boxy turrets, road wheels, segmented tracks, detail props) + numpy PBR texture generation (camo albedo, roughness wear, derived normals)
- `build_all.py` — per-vehicle configs and assembly; exports `<id>_LOD{0,1,2}.glb` into `assets/tanks/<id>/` and `public/tanks/<id>/`
- `preview.py` — headless Cycles preview renders
- `probe_glb.py` — prints the exported node hierarchy (debugging the rig contract)

Run:
```bash
blender --background --python build_all.py             # all vehicles × 3 LODs
blender --background --python build_all.py -- --tank=jackal
blender --background --python preview.py -- <glb> <png>
```

### 12. Asset Pipeline / 资产流程
Exported node contract (the engine rebinds these by name):
```
TankRoot
├── Hull
├── Turret (pivot: engine applies yaw)
│   └── Cannon (pivot: engine applies elevation + recoil offset)
│       └── Muzzle (empty: shell spawn point)
├── TrackL / TrackR
└── Wheels_L / Wheels_R
```
LOD0 ≤ 75 m · LOD1 ≤ 160 m · LOD2 beyond. Materials are Principled BSDF with embedded PNG textures (albedo / roughness / normal). Clones rebind materials per battle instance so wreck/cloak states stay per-tank.

### 13. Tank Data / 坦克数据
All stats live in `src/config/tanks.ts` (hp, 6-zone armor, damage, penetration, reload, speeds, rotation rates, dims, model linkage). Adding a vehicle = build a GLB + add one config entry. Combat tuning (penetration rolls, ricochet angle, module durations, verdict thresholds) lives in `src/config/combat.ts`.

### 14. Graphics Settings / 画面设置
Low / Medium / High control pixel ratio, shadows (off/1024/2048), particle scale, fog density, post-processing (bloom + grade + FXAA) and nameplate range. Settings persist in `localStorage`.

### 15. Performance Optimization / 性能优化
- 28 tanks at 60 FPS on a mid-range desktop (measured)
- 3-level LOD per vehicle, frustum culling, per-instance material clones only where needed
- pooled projectiles (one InstancedMesh), pooled GPU particles (3 draw calls), pooled debris/rings/lights
- staggered AI thinking (~4 Hz per tank), pure-function terrain (no heightfield lookup cost beyond math)
- merged static environment geometry (one draw call per material)

### 16. Controls / 操作方式
| Input | Action |
| --- | --- |
| W / S | forward / reverse |
| A / D | steer hull |
| Mouse | camera aim (turret follows) |
| LMB | fire |
| RMB / wheel | zoom gunner sight |
| Space | brake |
| Esc | pause |

### 17. Project Structure / 项目结构
See section 6. Vehicle sources: `assets/tanks/<id>/` (`*.glb`, `preview_LOD0.png`), shared textures in `assets/tanks/textures/`, pipeline scripts in `assets/tanks/_kit/`.

### 18. Known Issues / 已知问题
- In hidden browser tabs the render loop pauses by design (rAF throttling); boot completes regardless.
- Enemy nameplates are simple sprites; occlusion edges can shimmer at extreme zoom.
- AI pathing uses a coarse 8 m grid; tight building corners may require a reverse-and-retry.

### 19. Future Improvements / 未来计划
- Multiplayer (the Controller abstraction was designed for it)
- Domination / base-destruction modes
- More vehicles and maps via the same pipeline
- Optional GLTF animations for suspension details

### 20. Credits / 参考资料
- Design references: publicly available historical documentation and museum photographs of the M551 Sheridan, Type 62, M4 Sherman, M48 Patton, Tiger I, Maus, ISU-152 and AMX 50 Foch.
- Engine: Three.js — https://threejs.org
- Modeling: Blender — https://www.blender.org
- All TankMe assets (models, textures, sounds, map, UI) are original works generated for this project.

---

## 中文

### 1. 项目介绍
TankMe 是一款完全运行在浏览器中的快节奏团队坦克对战游戏。两支由 AI 驾驶的坦克队伍（外加玩家一辆）在「Ironridge Crossing / 铁脊隘口」交战——这是一张战术结构完整的地图，包含中央山脊、围墙村庄、工业废墟与侧翼路线。

### 2. 功能
- 同一张地图支持 7v7 与 14v14 团队死亡竞赛
- 8 辆原创车辆、4 个类别，每辆配备 3 级 LOD 的 GLB 模型
- 6 区域装甲（正面/侧面/后部/炮塔/车顶/履带）、随距离衰减的穿深、大角度跳弹、暴击、模块损伤（履带/发动机/火炮）
- 装甲指示器（大概率 / 有可能 / 较难 / 无法击穿）与模拟共用同一套数学
- 空投物资：伤害增强、防御增强、战地维修、隐身力场
- 角色化团队 AI（突击/侧翼/狙击/支援/防守）+ A* 寻路
- 程序化天空（流动云层）、PMREM 环境光照、Bloom + 电影级调色后处理
- WebAudio 程序化音效——零音频文件
- Low / Medium / High 画质预设、设置持久化、FPS 计数

### 3. 玩法
击毁敌方坦克为队伍得分。8 分钟计时结束时比分更高、或率先达到分数上限的队伍获胜。被击毁的坦克 6 秒后重生，并有 3 秒出生保护。

### 4. 坦克类型
| 类别 | 车辆 | 定位 |
| --- | --- | --- |
| 轻型 | KESTREL KL-1、JACKAL JL-3 | 高速侦察、侧翼骚扰、低装甲 |
| 中型 | BULWARK BM-4、VANGUARD VK-7 | 均衡主战坦克 |
| 重型 | IRONWOLF IH-8、COLOSSUS CS-9 | 厚甲重炮、机动缓慢 |
| 坦克歼击车 | MAUL MH-5、LANCE LL-6 | 固定战斗室、高爆发、火炮射界受限 |

### 5. 坦克设计参考
车辆均为**受公开历史资料启发的 TankMe 原创设计**（参考博物馆资料与历史照片，非游戏资产）。对照关系见上文英文表格：KESTREL 参考 Sheridan、JACKAL 参考 62 式、BULWARK 参考 M4 谢尔曼、VANGUARD 参考 M48 巴顿、IRONWOLF 参考虎式、COLOSSUS 参考鼠式、MAUL 参考 ISU-152、LANCE 参考 AMX 50 福熙。命名、数据、贴图、涂装与模型均为 TankMe 原创。

### 6. 项目架构
见上文英文第 6 节目录树。`src/config/` 集中所有数据驱动配置；`assets/tanks/` 为 Blender 建模工程与导出产物。

### 7. 技术栈
Vite · TypeScript（严格模式）· Three.js（WebGL2）· Blender 4.5 LTS + Python（资产管线）· WebAudio · DOM/CSS 界面

### 8. 安装方法
```bash
npm install
```
可选（仅在需要重建坦克模型时）：安装 Blender 4.5+ 并记录其路径。

### 9. 开发方法
```bash
npm run dev         # 开发服务器 → http://localhost:5173
npm run typecheck   # 严格 TypeScript 检查
npm run build       # 生产构建 → dist/
npm run preview     # 预览生产构建
```

### 10. 运行游戏
打开 http://localhost:5173 → **BATTLE** → 选择模式与车辆 → **DEPLOY**。
WASD 驾驶，鼠标瞄准（炮塔跟随），左键开火，右键/滚轮缩放瞄准镜，空格紧急制动，Esc 暂停。

### 11. Blender 建模流程
流程：历史参考 → 设计研究 → 参数化 Blender 建模 → PBR 材质 → 枢轴装配 → LOD → GLB 导出 → Three.js 集成 → 游戏内视觉打磨。

`assets/tanks/_kit/` 包含整条管线：
- `tank_kit.py` 参数化建模套件（放样车体、铸造/焊接炮塔、负重轮、分段履带、细节件）+ numpy 程序化 PBR 贴图（迷彩固有色、磨损粗糙度、派生法线）
- `build_all.py` 每辆车的配置与装配，导出 `<id>_LOD{0,1,2}.glb` 到 `assets/tanks/<id>/` 与 `public/tanks/<id>/`
- `preview.py` 无头 Cycles 预览渲染
- `probe_glb.py` 打印导出的节点层级（调试装配约定）

命令示例：
```bash
blender --background --python build_all.py             # 全部车辆 × 3 级 LOD
blender --background --python build_all.py -- --tank=jackal
blender --background --python preview.py -- <glb> <png>
```

### 12. 资产流程
导出的节点约定（引擎按名称重新绑定）：
```
TankRoot
├── Hull（车体）
├── Turret（炮塔枢轴：引擎施加回转）
│   └── Cannon（火炮枢轴：引擎施加俯仰与后坐位移）
│       └── Muzzle（空节点：炮弹生成点）
├── TrackL / TrackR（左右履带）
└── Wheels_L / Wheels_R（左右负重轮）
```
LOD0 ≤ 75 米 · LOD1 ≤ 160 米 · 更远使用 LOD2。材质为 Principled BSDF + 内嵌 PNG 贴图（固有色 / 粗糙度 / 法线）。战斗中克隆材质到每辆实例，击毁/隐身状态互不影响。

### 13. 坦克数据
全部数值位于 `src/config/tanks.ts`（生命值、6 区域装甲、伤害、穿深、装填、机动、尺寸、模型关联）。新增车辆 = 构建一个 GLB + 增加一条配置。战斗调参（穿深浮动、跳弹角度、模块持续时间、击穿判定阈值）位于 `src/config/combat.ts`。

### 14. 画面设置
Low / Medium / High 控制像素比、阴影（关/1024/2048）、粒子规模、雾密度、后处理（Bloom + 调色 + FXAA）与名牌显示距离。设置保存在 `localStorage`。

### 15. 性能优化
- 实测中端桌面 28 辆坦克 60 FPS
- 每辆车 3 级 LOD、视锥剔除、仅在需要处克隆材质
- 炮弹对象池（单个 InstancedMesh）、GPU 粒子池（3 个 draw call）、碎片/冲击环/灯光对象池
- AI 思考错峰（每辆约 4 Hz）、地形为纯函数（无高度场查表）
- 静态环境按材质合并（每种材质一个 draw call）

### 16. 操作方式
| 输入 | 动作 |
| --- | --- |
| W / S | 前进 / 倒车 |
| A / D | 车体转向 |
| 鼠标 | 相机瞄准（炮塔跟随） |
| 左键 | 开火 |
| 右键 / 滚轮 | 瞄准镜缩放 |
| 空格 | 制动 |
| Esc | 暂停 |

### 17. 项目结构
见第 6 节。车辆资产：`assets/tanks/<id>/`（`*.glb`、`preview_LOD0.png`），共享贴图在 `assets/tanks/textures/`，管线脚本在 `assets/tanks/_kit/`。

### 18. 已知问题
- 浏览器后台标签页中渲染循环按设计暂停（rAF 节流）；启动流程不受影响
- 敌方名牌为简单精灵，极端变焦时遮挡边缘可能轻微闪烁
- AI 使用 8 米粗网格寻路，贴墙死角偶尔需要倒车重试

### 19. 未来计划
- 多人联机（Controller 抽象已为此预留）
- 占领点 / 基地摧毁模式
- 用同一管线扩充车辆与地图
- 可选的 GLTF 悬挂细节动画

### 20. 参考资料 / Credits
- 设计参考：M551 Sheridan、62 式坦克、M4 谢尔曼、M48 巴顿、虎式、鼠式、ISU-152、AMX 50 福熙的公开历史文档与博物馆照片
- 引擎：Three.js — https://threejs.org
- 建模：Blender — https://www.blender.org
- TankMe 的全部资产（模型、贴图、音效、地图、界面）均为本项目原创生成

## Static Deployment / 静态网站部署

TankMe is a client-only game: no backend, account, database, or multiplayer server is required. / TankMe 是纯前端游戏，无需后端、账号、数据库或多人服务器。

```bash
npm install
npm run typecheck
npm run build
npm run preview  # optional: test the production build locally
```

Upload the **contents of `dist/`** as the website root. Vite copies the tank GLBs from `public/tanks/` into `dist/tanks/`; Blender source files under `assets/` are not needed by the hosted game. The current battle uses procedural `TankVisual` models rather than requesting those GLBs; deployment does not change that behavior. The build uses a relative Vite base, so the same output works at a domain root or a repository subpath such as `/TankMe/`. Serve it over HTTPS; WebGL is required, and browser audio starts after the user interacts with the page. Settings are saved only in that browser's `localStorage`.

把 **`dist/` 的内容**作为网站根目录部署。GLB 会从 `public/tanks/` 复制到 `dist/tanks/`，`assets/` 中的 Blender 源文件无需部署。当前战斗实际使用程序化 `TankVisual` 模型，并未请求这些 GLB；部署不会改变现有外观。当前 Vite 使用相对 `base`，因此既可部署到域名根路径，也可部署到 `/TankMe/` 这样的子路径。请使用 HTTPS；浏览器需支持 WebGL，音效在用户操作页面后启用，设置只保存在该浏览器的 `localStorage`。

- **Vercel:** Import this repository, select `development` as the production branch if that is the branch you want to publish, and use the Vite preset. Build Command: `npm run build`; Output Directory: `dist`; Install Command: `npm install`. No `vercel.json` is needed.
- **Netlify:** Import this repository and select the intended deploy branch (for example `development`). Build command: `npm run build`; publish directory: `dist`.
- **GitHub Pages:** Use a build-and-deploy GitHub Actions workflow from the intended branch (for example `development`) that uploads `dist/` as the Pages artifact; set Settings → Pages → Source to **GitHub Actions**. Do not select “Deploy from a branch” with the unbuilt source tree. The relative base already supports the repository URL `https://BW6Z.github.io/TankMe/`.

There is no client-side router, so no SPA rewrite or fallback rule is needed. / 项目没有客户端路由，不需要额外的 SPA 重写规则。
