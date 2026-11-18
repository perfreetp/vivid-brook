<script lang="ts">
	import { onMount, untrack } from 'svelte';
	import * as THREE from 'three';
	import { ViewportEngine, type ToolMode, type TransformSpace } from '$lib/engine/viewport';
	import { buildBuiltinHumanoid, importMeshFile } from '$lib/engine/mesh';
	import { createJoint, deleteJoint, renameJoint, reparent, computeBindWorldMatrices, jointWorldPosition } from '$lib/engine/skeleton';
	import { nonNormalizedVertices, normalizeWeights } from '$lib/engine/weights';
	import { makeKeyframe } from '$lib/engine/interpolation';
	import { expandSegments, samplePoseAt, totalTimelineFrames, clipOf, frameToSource } from '$lib/engine/timeline';
	import { exportSequence, downloadBlob, buildSkeletonJson } from '$lib/engine/exporter';
	import { deepClone } from '$lib/engine/clone';
	import { api } from '$lib/api';
	import type {
		BoneTrack,
		Clip,
		EditorProject,
		InterpMode,
		JointData,
		NamedPose,
		SkeletonData,
		WeightMap,
		Keyframe,
		Vec2
	} from '$lib/types';
	import { VOLTAGE_LEVELS, WORK_TYPES } from '$lib/types';
	import SkeletonTree from '$lib/components/SkeletonTree.svelte';
	import Timeline from '$lib/components/Timeline.svelte';
	import BezierEditor from '$lib/components/BezierEditor.svelte';

	// 可选：载入已有课件（审片退回后修改重提）；不传则为空白新工程
	let { initialCourse }: { initialCourse?: import('$lib/types').Course | null } = $props();
	// 仅取首次挂载时的值，后续编辑不随父级引用变化
	const initial = untrack(() => initialCourse ?? null);

	// ---------- 工程状态 ----------
	let project = $state<EditorProject>(initial
		? deepClone(initial.versions.find((v) => v.version === initial.currentVersion)!.project)
		: blankProject());
	let selectedJointId = $state<string | null>(null);
	let selectedKeyId = $state<string | null>(null);
	let tool = $state<ToolMode>('select');
	let space = $state<TransformSpace>('translate');
	let showWeights = $state(false);
	let currentFrame = $state(0);
	let playing = $state(false);
	let brushRadius = $state(0.14);
	let brushStrength = $state(0.18);
	let brushReplace = $state(false);
	let exportProgress = $state<{ frame: number; total: number } | null>(null);
	let toast = $state('');
	let saveMeta = $state<{
		courseId: string;
		title: string;
		voltageLevel: import('$lib/types').VoltageLevel;
		workType: import('$lib/types').WorkType;
		instructor: string;
	}>(initial
		? {
			courseId: initial.id,
			title: initial.title,
			voltageLevel: initial.voltageLevel,
			workType: initial.workType,
			instructor: initial.instructor
		}
		: { courseId: '', title: '', voltageLevel: '10kV', workType: '带电检测', instructor: '王讲师' });
	let bezierPair = $state<{ prev: Keyframe; next: Keyframe; jointId: string } | null>(null);
	let newClipName = $state('新动作片段');
	let newClipLoop = $state(1);

	let viewportEl: HTMLDivElement | null = $state(null);
	let engine: ViewportEngine | null = null;
	let playTimer: ReturnType<typeof setInterval> | null = null;
	let fileInput: HTMLInputElement | null = null;

	function blankProject(): EditorProject {
		return {
			meta: { title: '未命名带电作业课件', fps: 24, durationFrames: 96, meshSource: 'builtin', meshName: '内置简化人体', vertexCount: 0 },
			skeleton: { rootId: null, joints: [] },
			weights: {},
			tracks: [],
			clips: [clipOf({ name: '主动作', startFrame: 0, endFrame: 95 }, 0)],
			poseLibrary: []
		};
	}

	function showToast(msg: string) {
		toast = msg;
		setTimeout(() => (toast = ''), 2600);
	}

	onMount(() => {
		if (!viewportEl) return;
		engine = new ViewportEngine(viewportEl, {
			onSelectJoint: (id) => (selectedJointId = id),
			onJointMove: (id, position, rotation) => applyJointMove(id, position, rotation),
			onPaint: (w) => (project.weights = w),
			onAddJointAt: (point) => addJointAt(point)
		});
		// canvas 挂到受管空 div，Svelte 重渲染不会清除（div 内无其它声明子节点）
		viewportEl.appendChild(engine.canvas);
		engine.resize();
		const geo = buildBuiltinHumanoid();
		if (!initialCourse) project.meta.vertexCount = geo.attributes.position.count;
		engine.setGeometry(geo);
		// 载入已有课件的骨骼与权重
		if (initial && project.skeleton.joints.length > 0) {
			engine.setSkeleton(project.skeleton);
			engine.setWeights(project.weights);
		}
		engine.frameCamera();
		return () => engine?.dispose();
	});

	// ---------- 网格导入 ----------
	async function onMeshFile(e: Event) {
		const input = e.currentTarget as HTMLInputElement;
		const file = input.files?.[0];
		if (!file || !engine) return;
		try {
			const imported = await importMeshFile(file);
			engine.setGeometry(imported.geometry);
			project.meta.meshSource = imported.source;
			project.meta.meshName = imported.name;
			project.meta.vertexCount = imported.geometry.attributes.position.count;
			project.weights = {};
			engine.setWeights({});
			engine.frameCamera();
			showToast(`已导入网格：${imported.name}（${imported.geometry.attributes.position.count} 顶点）`);
		} catch (err) {
			showToast(`导入失败：${(err as Error).message}`);
		}
		input.value = '';
	}

	// ---------- 骨骼搭建 ----------
	function addJointAt(point: THREE.Vector3) {
		if (!engine) return;
		const parentId = selectedJointId ?? project.skeleton.rootId;
		let localPos: [number, number, number] = [point.x, point.y, point.z];
		if (parentId) {
			const parentWorld = computeBindWorldMatrices(project.skeleton).get(parentId);
			if (parentWorld) {
				const local = new THREE.Matrix4().makeTranslation(point.x, point.y, point.z).premultiply(parentWorld.clone().invert());
				const p = new THREE.Vector3().setFromMatrixPosition(local);
				localPos = [p.x, p.y, p.z];
			}
		}
		const joint = createJoint(`关节 ${project.skeleton.joints.length + 1}`, parentId, localPos);
		const joints = [...project.skeleton.joints, joint];
		project.skeleton = { rootId: project.skeleton.rootId ?? joint.id, joints };
		engine.setSkeleton(project.skeleton);
		selectedJointId = joint.id;
		engine.selectJoint(joint.id);
		ensureTrack(joint.id);
	}

	function applyJointMove(id: string, position: [number, number, number], rotation: [number, number, number, number]) {
		project.skeleton = {
			...project.skeleton,
			joints: project.skeleton.joints.map((j) => (j.id === id ? { ...j, position, rotation } : j))
		};
		engine?.setSkeleton(project.skeleton);
		engine?.syncMarkersFromSkeleton();
	}

	function handleReparent(jointId: string, newParentId: string | null) {
		project.skeleton = reparent(project.skeleton, jointId, newParentId);
		engine?.setSkeleton(project.skeleton);
	}
	function handleDelete(id: string) {
		project.skeleton = deleteJoint(project.skeleton, id);
		project.tracks = project.tracks.filter((t) => t.jointId !== id);
		if (selectedJointId === id) selectedJointId = null;
		engine?.setSkeleton(project.skeleton);
	}
	function handleRename(id: string, name: string) {
		project.skeleton = renameJoint(project.skeleton, id, name);
	}

	function ensureTrack(jointId: string): BoneTrack {
		let track = project.tracks.find((t) => t.jointId === jointId);
		if (!track) {
			track = { jointId, keys: [] };
			project.tracks = [...project.tracks, track];
		}
		return track;
	}

	// ---------- 工具切换 ----------
	function setTool(t: ToolMode) {
		tool = t;
		engine?.setTool(t);
	}
	function setSpace(s: TransformSpace) {
		space = s;
		engine?.setSpace(s);
	}
	function toggleWeights() {
		showWeights = !showWeights;
		engine?.setShowWeights(showWeights);
	}

	$effect(() => {
		engine?.setWeights(project.weights);
	});
	$effect(() => {
		if (engine) {
			engine.brushRadius = brushRadius;
			engine.brushStrength = brushStrength;
			engine.brushReplace = brushReplace;
		}
	});

	const redVertices = $derived(nonNormalizedVertices(project.weights));

	function doNormalize() {
		project.weights = normalizeWeights(project.weights);
		showToast('已对全部顶点权重执行归一化');
	}

	// ---------- 关键帧 ----------
	function currentLocalTRS(joint: JointData) {
		return { position: [...joint.position] as [number, number, number], rotation: [...joint.rotation] as [number, number, number, number], scale: [...joint.scale] as [number, number, number] };
	}

	function addKeyAt(frame: number) {
		if (!selectedJointId) {
			showToast('请先在视口或骨骼树选中一个关节');
			return;
		}
		const joint = project.skeleton.joints.find((j) => j.id === selectedJointId);
		if (!joint) return;
		const track = ensureTrack(selectedJointId);
		const kf = makeKeyframe(frame, currentLocalTRS(joint), 'linear');
		const keys = track.keys.filter((k) => k.frame !== frame);
		keys.push(kf);
		keys.sort((a, b) => a.frame - b.frame);
		project.tracks = project.tracks.map((t) => (t.jointId === track!.jointId ? { ...t, keys } : t));
		selectedKeyId = kf.id;
		showToast(`已在帧 ${frame} 为「${joint.name}」打关键帧`);
	}

	function selectKey(jointId: string, keyId: string) {
		selectedKeyId = keyId;
		const track = project.tracks.find((t) => t.jointId === jointId);
		if (!track) return;
		const sorted = [...track.keys].sort((a, b) => a.frame - b.frame);
		const idx = sorted.findIndex((k) => k.id === keyId);
		const prev = sorted[Math.max(0, idx - 1)];
		const next = sorted[idx + 1];
		if (prev && next && prev.interp === 'bezier') {
			bezierPair = { prev, next, jointId };
		} else {
			bezierPair = null;
		}
	}

	function moveKey(jointId: string, keyId: string, frame: number) {
		project.tracks = project.tracks.map((t) =>
			t.jointId === jointId ? { ...t, keys: t.keys.map((k) => (k.id === keyId ? { ...k, frame } : k)) } : t
		);
	}
	function deleteKey(jointId: string, keyId: string) {
		project.tracks = project.tracks.map((t) =>
			t.jointId === jointId ? { ...t, keys: t.keys.filter((k) => k.id !== keyId) } : t
		);
		if (selectedKeyId === keyId) selectedKeyId = null;
	}
	function setInterp(jointId: string, keyId: string, interp: InterpMode) {
		project.tracks = project.tracks.map((t) =>
			t.jointId === jointId ? { ...t, keys: t.keys.map((k) => (k.id === keyId ? { ...k, interp } : k)) } : t
		);
		selectKey(jointId, keyId);
	}
	function changeHandles(outHandle: Vec2, inHandle: Vec2) {
		if (!bezierPair) return;
		const { jointId, prev, next } = bezierPair;
		project.tracks = project.tracks.map((t) =>
			t.jointId === jointId
				? {
					...t,
					keys: t.keys.map((k) =>
						k.id === prev.id ? { ...k, outHandle } : k.id === next.id ? { ...k, inHandle } : k
					)
				}
				: t
		);
		const updatedPrev = project.tracks.find((t) => t.jointId === jointId)!.keys.find((k) => k.id === prev.id)!;
		const updatedNext = project.tracks.find((t) => t.jointId === jointId)!.keys.find((k) => k.id === next.id)!;
		bezierPair = { prev: updatedPrev, next: updatedNext, jointId };
	}

	// ---------- 片段 ----------
	function addClip() {
		const order = project.clips.length;
		const clip = clipOf({ name: newClipName || `片段 ${order + 1}`, startFrame: 0, endFrame: Math.min(95, project.meta.durationFrames - 1), loopCount: newClipLoop }, order);
		project.clips = [...project.clips, clip];
	}
	function updateClip(id: string, patch: Partial<Clip>) {
		project.clips = project.clips.map((c) => (c.id === id ? { ...c, ...patch } : c));
	}
	function removeClip(id: string) {
		project.clips = project.clips.filter((c) => c.id !== id).map((c, i) => ({ ...c, order: i }));
	}
	const totalFrames = $derived(totalTimelineFrames(project.clips, project.meta.durationFrames));

	// ---------- 播放 ----------
	function seek(frame: number) {
		currentFrame = Math.max(0, Math.min(totalFrames - 1, frame));
		applyPlayFrame();
	}
	function applyPlayFrame() {
		const segs = expandSegments(project.clips);
		const pose = samplePoseAt(project.skeleton, project.tracks, currentFrame, segs);
		engine?.applyAnimatedPose(pose);
		if (selectedJointId) {
			// 计算源帧用于调试/显示（片段展开后的映射）
			frameToSource(segs, currentFrame);
		}
	}
	function togglePlay() {
		if (playing) {
			stopPlay();
			return;
		}
		playing = true;
		engine?.setPlayMode(true);
		playTimer = setInterval(() => {
			if (currentFrame >= totalFrames - 1) {
				currentFrame = 0;
			} else {
				currentFrame++;
			}
			applyPlayFrame();
			if (currentFrame >= totalFrames - 1) {
				// 播完一次即停（片段循环已在时间轴展开中体现）
			}
		}, 1000 / project.meta.fps);
	}
	function stopPlay() {
		playing = false;
		engine?.setPlayMode(false);
		if (playTimer) clearInterval(playTimer);
	}
	function showTrajectory() {
		if (!selectedJointId || !engine) {
			showToast('请先选中一个骨骼关节');
			return;
		}
		const segs = expandSegments(project.clips);
		const pts: [number, number, number][] = [];
		for (let f = 0; f <= currentFrame; f++) {
			const pose = samplePoseAt(project.skeleton, project.tracks, f, segs);
			pts.push(jointWorldPosition(project.skeleton, pose, selectedJointId));
		}
		engine.showTrajectory(pts);
		showToast(`已显示选中骨骼 0→${currentFrame} 帧轨迹（${pts.length} 个采样点）`);
	}

	// ---------- 姿态库 ----------
	function savePose() {
		if (!selectedJointId) {
			showToast('选中关节后再存入姿态库');
			return;
		}
		const joints: NamedPose['joints'] = {};
		for (const j of project.skeleton.joints) {
			joints[j.id] = { position: [...j.position], rotation: [...j.rotation], scale: [...j.scale] };
		}
		const pose: NamedPose = { id: `pose_${crypto.randomUUID().slice(0, 8)}`, name: `姿态 ${project.poseLibrary.length + 1}`, joints };
		project.poseLibrary = [...project.poseLibrary, pose];
		showToast(`姿态「${pose.name}」已入库`);
	}
	function applyPose(pose: NamedPose) {
		project.skeleton = {
			...project.skeleton,
			joints: project.skeleton.joints.map((j) => {
				const trs = pose.joints[j.id];
				return trs ? { ...j, position: [...trs.position], rotation: [...trs.rotation], scale: [...trs.scale] } : j;
			})
		};
		engine?.setSkeleton(project.skeleton);
		showToast(`已应用姿态「${pose.name}」`);
	}
	function deletePose(id: string) {
		project.poseLibrary = project.poseLibrary.filter((p) => p.id !== id);
	}

	// ---------- 导出 ----------
	async function doExport() {
		if (!engine) return;
		stopPlay();
		exportProgress = { frame: 0, total: totalFrames };
		try {
			const blob = await exportSequence(engine, project, (p) => (exportProgress = p));
			downloadBlob(blob, `${project.meta.title || '课件'}_24fps序列帧.zip`);
			showToast('PNG 序列帧 + 骨架 JSON 已打包导出');
		} finally {
			exportProgress = null;
		}
	}
	function exportSkeletonOnly() {
		const blob = new Blob([buildSkeletonJson(project)], { type: 'application/json' });
		downloadBlob(blob, `${project.meta.title || 'skeleton'}.skeleton.json`);
	}

	// ---------- 后台保存 / 提交 ----------
	async function saveToServer(submit: boolean) {
		try {
			if (saveMeta.courseId) {
				const course = submit
					? await api.submit(saveMeta.courseId, project)
					: await api.saveDraft(saveMeta.courseId, project);
				showToast(submit ? `已提交审核，新版本 v${course.currentVersion}` : '草稿已保存');
			} else {
				const course = await api.createCourse({
					title: saveMeta.title || project.meta.title,
					voltageLevel: saveMeta.voltageLevel,
					workType: saveMeta.workType,
					instructor: saveMeta.instructor,
					project
				});
				saveMeta.courseId = course.id;
				history.replaceState(null, '', `/editor/${course.id}`);
				showToast(`已创建课件并归类到 ${saveMeta.voltageLevel} / ${saveMeta.workType}`);
			}
		} catch (err) {
			showToast(`保存失败：${(err as Error).message}`);
		}
	}

	const selectedJoint = $derived(project.skeleton.joints.find((j) => j.id === selectedJointId) ?? null);
</script>

<div class="editor-shell">
	<!-- 顶部工具条 -->
	<div class="toolbar panel">
		<input value={project.meta.title} oninput={(e) => (project.meta.title = (e.currentTarget as HTMLInputElement).value)} style="width:220px" />
		<div class="divider"></div>
		<button class:toggled={tool === 'select'} onclick={() => setTool('select')}>选择/拖动</button>
		<button class:toggled={tool === 'addJoint'} onclick={() => setTool('addJoint')}>＋ 点关节</button>
		<button class:toggled={tool === 'paint'} onclick={() => setTool('paint')}>画刷涂权重</button>
		<div class="divider"></div>
		<button class:toggled={space === 'translate'} onclick={() => setSpace('translate')}>移动</button>
		<button class:toggled={space === 'rotate'} onclick={() => setSpace('rotate')}>旋转</button>
		<button class:toggled={space === 'scale'} onclick={() => setSpace('scale')}>缩放</button>
		<div class="divider"></div>
		<button class:toggled={showWeights} onclick={toggleWeights}>
			权重视图
			{#if redVertices.length > 0}<span class="danger-text">（{redVertices.length} 顶点未归一）</span>{/if}
		</button>
		<button onclick={doNormalize} disabled={redVertices.length === 0}>一键归一</button>
		<div class="spacer"></div>
		<button onclick={() => fileInput?.click()}>导入网格</button>
		<input type="file" accept=".obj,.glb,.gltf" bind:this={fileInput} onchange={onMeshFile} hidden />
		<button onclick={exportSkeletonOnly}>骨架 JSON</button>
		<button class="primary" onclick={doExport} disabled={exportProgress !== null}>
			{exportProgress ? `导出中 ${exportProgress.frame}/${exportProgress.total}` : '导出 24fps 序列帧'}
		</button>
	</div>

	<div class="main-grid">
		<!-- 左栏：骨骼树 + 姿态库 -->
		<div class="side col">
			<div class="panel">
				<h3>骨骼树（拖节点调父子）</h3>
				<SkeletonTree
					skeleton={project.skeleton}
					{selectedJointId}
					onSelect={(id) => {
						selectedJointId = id;
						engine?.selectJoint(id);
					}}
					onReparent={handleReparent}
					onDelete={handleDelete}
					onRename={handleRename}
				/>
			</div>

			<div class="panel">
				<h3>姿态库</h3>
				<button onclick={savePose} style="width:100%;margin-bottom:8px">存当前绑定姿势</button>
				<div class="pose-list">
					{#each project.poseLibrary as pose (pose.id)}
						<div class="pose-item">
							<span>{pose.name}</span>
							<span class="row" style="gap:4px">
								<button onclick={() => applyPose(pose)}>取用</button>
								<button class="danger" onclick={() => deletePose(pose.id)}>删</button>
							</span>
						</div>
					{/each}
					{#if project.poseLibrary.length === 0}<span class="muted small">暂无保存的姿态</span>{/if}
				</div>
			</div>

			<div class="panel">
				<h3>片段拼接（首尾相接 + 循环）</h3>
				<div class="row" style="margin-bottom:8px">
					<input bind:value={newClipName} placeholder="片段名" style="width:110px" />
					<input type="number" min="1" max="20" bind:value={newClipLoop} style="width:64px" title="循环次数" />
					<button onclick={addClip}>追加片段</button>
				</div>
				{#each [...project.clips].sort((a, b) => a.order - b.order) as clip (clip.id)}
					<div class="clip-item">
						<span class="clip-order">{clip.order + 1}</span>
						<input value={clip.name} onchange={(e) => updateClip(clip.id, { name: (e.currentTarget as HTMLInputElement).value })} style="width:96px" />
						<label class="small muted">帧 <input type="number" value={clip.startFrame} onchange={(e) => updateClip(clip.id, { startFrame: +(e.currentTarget as HTMLInputElement).value })} style="width:52px" />
							-<input type="number" value={clip.endFrame} onchange={(e) => updateClip(clip.id, { endFrame: +(e.currentTarget as HTMLInputElement).value })} style="width:52px" /></label>
						<label class="small muted">×<input type="number" min="1" max="50" value={clip.loopCount} onchange={(e) => updateClip(clip.id, { loopCount: +(e.currentTarget as HTMLInputElement).value })} style="width:52px" /></label>
						<button class="danger" onclick={() => removeClip(clip.id)}>✕</button>
					</div>
				{/each}
				<p class="small muted" style="margin-bottom:0">拼接后时间轴总长：<b>{totalFrames}</b> 帧（{project.meta.fps}fps ≈ {(totalFrames / project.meta.fps).toFixed(1)} 秒）</p>
			</div>
		</div>

		<!-- 中央视口 -->
		<div class="center col">
			<div class="viewport-wrap panel" style="padding:0;overflow:hidden">
				<div bind:this={viewportEl} class="viewport"></div>
				<div class="viewport-hud">
					<span class="tag">当前帧 <b>{currentFrame}</b> / {totalFrames - 1}</span>
					<span class="tag">{tool === 'paint' ? '权重画刷' : tool === 'addJoint' ? '点击网格放关节' : '选择模式'}</span>
					{#if selectedJoint}<span class="tag review">选中：{selectedJoint.name}</span>{/if}
					{#if redVertices.length > 0 && showWeights}<span class="tag reject">红色 = 权重未归一（{redVertices.length}）</span>{/if}
				</div>
				{#if exportProgress}
					<div class="export-mask">
						<div>正在逐帧渲染 {exportProgress.frame} / {exportProgress.total}…</div>
						<div class="progress"><div class="pfill" style={`width:${(exportProgress.frame / exportProgress.total) * 100}%`}></div></div>
					</div>
				{/if}
			</div>

			{#if bezierPair}
				<div class="panel bezier-panel">
					<h3>贝塞尔切线手柄（可拖拽）— {bezierPair.jointId}</h3>
					<BezierEditor prev={bezierPair.prev} next={bezierPair.next} onChange={changeHandles} />
				</div>
			{/if}

			<div class="panel">
				<div class="row transport">
					<button class="primary" onclick={togglePlay}>{playing ? '⏸ 暂停' : '▶ 播放'}</button>
					<button onclick={() => { stopPlay(); seek(0); }}>⏹ 回起点</button>
					<button onclick={showTrajectory}>显示选中骨骼轨迹</button>
					<button onclick={() => engine?.clearTrajectory()}>清除轨迹</button>
					<div class="spacer"></div>
					<span class="small muted">帧步进：</span>
					<button onclick={() => seek(currentFrame - 1)}>◀</button>
					<button onclick={() => seek(currentFrame + 1)}>▶</button>
				</div>
				<Timeline
					tracks={project.tracks}
					clips={project.clips}
					durationFrames={totalFrames}
					{currentFrame}
					{selectedJointId}
					{selectedKeyId}
					onSeek={seek}
					onAddKey={addKeyAt}
					onSelectKey={selectKey}
					onMoveKey={moveKey}
					onDeleteKey={deleteKey}
					onSetInterp={setInterp}
				/>
			</div>
		</div>

		<!-- 右栏：属性 / 画刷 / 保存归类 -->
		<div class="side col">
			<div class="panel">
				<h3>关节属性</h3>
				{#if selectedJoint}
					<div class="small col" style="gap:6px">
						<div><span class="muted">名称：</span>{selectedJoint.name}</div>
						<div><span class="muted">ID：</span><span class="small">{selectedJoint.id}</span></div>
						<div><span class="muted">父关节：</span>{selectedJoint.parentId ?? '根'}</div>
						<div class="muted">局部位置（绑定姿势）</div>
						<div class="row">
							{#each ['x', 'y', 'z'] as axis, i}
								<label class="num-input">{axis}<input type="number" step="0.01" value={selectedJoint.position[i]}
									onchange={(e) => {
										const pos = [...selectedJoint.position] as [number, number, number];
										pos[i] = +(e.currentTarget as HTMLInputElement).value;
										applyJointMove(selectedJoint.id, pos, selectedJoint.rotation);
									}} /></label>
							{/each}
						</div>
					</div>
				{:else}
					<p class="muted small">未选中关节</p>
				{/if}
			</div>

			<div class="panel">
				<h3>权重画刷参数</h3>
				<label class="small col" style="gap:8px">
					<span class="muted">半径 {brushRadius.toFixed(2)}</span>
					<input type="range" min="0.03" max="0.4" step="0.01" bind:value={brushRadius} />
					<span class="muted">强度 {brushStrength.toFixed(2)}</span>
					<input type="range" min="0.02" max="0.6" step="0.02" bind:value={brushStrength} />
					<label class="row"><input type="checkbox" bind:checked={brushReplace} /> 替换模式（默认按比例挤占其它关节）</label>
					<span class="muted">未归一顶点数：<b class:danger-text={redVertices.length > 0}>{redVertices.length}</b></span>
				</label>
			</div>

			<div class="panel">
				<h3>课件归类与送审</h3>
				<div class="col" style="gap:8px">
					<label class="small muted">课件标题<input value={saveMeta.title} placeholder={project.meta.title} oninput={(e) => (saveMeta.title = (e.currentTarget as HTMLInputElement).value)} style="width:100%" /></label>
					<label class="small muted">电压等级
						<select bind:value={saveMeta.voltageLevel} style="width:100%">{#each VOLTAGE_LEVELS as v}<option>{v}</option>{/each}</select>
					</label>
					<label class="small muted">作业类型
						<select bind:value={saveMeta.workType} style="width:100%">{#each WORK_TYPES as t}<option>{t}</option>{/each}</select>
					</label>
					<label class="small muted">讲师<input bind:value={saveMeta.instructor} style="width:100%" /></label>
					{#if saveMeta.courseId}<p class="small muted">已关联课件 ID：{saveMeta.courseId}</p>{/if}
					<div class="row">
						<button onclick={() => saveToServer(false)}>存草稿</button>
						<button class="primary" onclick={() => saveToServer(true)}>提交审核（生成新版本）</button>
					</div>
				</div>
			</div>
		</div>
	</div>
</div>

{#if toast}<div class="toast">{toast}</div>{/if}

<style>
	.editor-shell {
		display: flex;
		flex-direction: column;
		gap: 12px;
	}
	.toolbar {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 10px 12px;
		flex-wrap: wrap;
	}
	.divider {
		width: 1px;
		height: 24px;
		background: var(--border);
	}
	.main-grid {
		display: grid;
		grid-template-columns: 290px 1fr 300px;
		gap: 12px;
		align-items: start;
	}
	.side {
		min-width: 0;
	}
	.center {
		min-width: 0;
	}
	.viewport-wrap {
		position: relative;
	}
	.viewport {
		height: 460px;
	}
	.viewport :global(canvas) {
		display: block;
	}
	.viewport-hud {
		position: absolute;
		top: 10px;
		left: 10px;
		display: flex;
		gap: 8px;
		pointer-events: none;
	}
	.export-mask {
		position: absolute;
		inset: 0;
		background: rgba(10, 14, 20, 0.78);
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 14px;
	}
	.progress {
		width: 320px;
		height: 10px;
		background: var(--bg-3);
		border-radius: 6px;
		overflow: hidden;
	}
	.pfill {
		height: 100%;
		background: var(--accent);
		transition: width 0.15s;
	}
	.transport {
		margin-bottom: 10px;
		flex-wrap: wrap;
	}
	.bezier-panel {
		margin-top: 12px;
	}
	.pose-list {
		display: flex;
		flex-direction: column;
		gap: 6px;
		max-height: 160px;
		overflow: auto;
	}
	.pose-item,
	.clip-item {
		display: flex;
		align-items: center;
		gap: 6px;
		flex-wrap: wrap;
	}
	.clip-item {
		padding: 6px 0;
		border-bottom: 1px solid var(--border);
	}
	.clip-order {
		width: 20px;
		height: 20px;
		border-radius: 50%;
		background: var(--accent);
		color: #fff;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		font-size: 12px;
		flex: none;
	}
	.num-input {
		flex: 1;
		font-size: 12px;
	}
	.num-input input {
		width: 100%;
	}
	.toast {
		position: fixed;
		bottom: 26px;
		left: 50%;
		transform: translateX(-50%);
		background: #1f2c3f;
		border: 1px solid var(--border);
		padding: 10px 18px;
		border-radius: 8px;
		z-index: 100;
		box-shadow: 0 8px 30px rgba(0, 0, 0, 0.5);
	}
	@media (max-width: 1280px) {
		.main-grid {
			grid-template-columns: 1fr;
		}
	}
</style>
