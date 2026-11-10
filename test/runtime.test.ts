import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	clearRuntimeInfoCache,
	detectRuntime,
	readRuntimeInfo,
	runtimeMetadata,
} from "../extensions/zentui/runtime";

function starshipRuntimeModules(): string[] {
	const toml = readFileSync("test/fixtures/starship-nerd-font-symbols.toml", "utf8");
	return Array.from(toml.matchAll(/^\[([^\]]+)\]/gm), (match) => match[1]).sort();
}

function makeProject(entries: Array<{ path: string; dir?: boolean }>): {
	cwd: string;
	names: string[];
} {
	const cwd = mkdtempSync(join(tmpdir(), "zentui-runtime-"));
	for (const entry of entries) {
		const fullPath = join(cwd, entry.path);
		if (entry.dir) mkdirSync(fullPath, { recursive: true });
		else writeFileSync(fullPath, "", "utf8");
	}
	return { cwd, names: entries.map((entry) => entry.path) };
}

describe("runtimeMetadata", () => {
	it("covers Starship Nerd Font runtime and language modules with icons and no defined colors", () => {
		const byName = new Map(runtimeMetadata.map((runtime) => [runtime.name, runtime]));

		expect([...byName.keys()].sort()).toEqual(starshipRuntimeModules());
		expect(byName.get("bun")).toMatchObject({
			symbol: "",
			style: "",
		});
		expect(byName.get("deno")).toMatchObject({
			symbol: "",
			style: "",
		});
		expect(byName.get("golang")).toMatchObject({
			symbol: "",
			style: "",
		});
		expect(byName.get("java")).toMatchObject({
			symbol: "",
			style: "",
		});
		expect(byName.get("nodejs")).toMatchObject({
			symbol: "",
			style: "",
		});
		expect(byName.get("opa")).toMatchObject({
			symbol: "",
			style: "",
		});
		expect(byName.get("zig")).toMatchObject({
			symbol: "",
			style: "",
		});
		for (const runtime of runtimeMetadata) {
			expect(Object.keys(runtime).sort()).toEqual(["name", "style", "symbol"]);
			expect(runtime.style).toBe("");
		}
	});
});

describe("detectRuntime", () => {
	it("prefers bun over node when both markers exist", () => {
		const project = makeProject([{ path: "package.json" }, { path: "bun.lock" }]);
		const runtime = detectRuntime(project.cwd, project.names);
		if (!runtime) throw new Error("expected runtime");
		expect(runtime.name).toBe("bun");
	});

	it("detects deno from config files", () => {
		const project = makeProject([{ path: "deno.json" }]);
		const runtime = detectRuntime(project.cwd, project.names);
		if (!runtime) throw new Error("expected runtime");
		expect(runtime.name).toBe("deno");
		expect(runtime.style).toBe("");
	});

	it("keeps existing node priority when node and go markers both exist", () => {
		const project = makeProject([{ path: "package.json" }, { path: "go.mod" }]);
		const runtime = detectRuntime(project.cwd, project.names);
		if (!runtime) throw new Error("expected runtime");
		expect(runtime.name).toBe("nodejs");
	});

	it("keeps existing runtime detection markers narrow", () => {
		for (const marker of ["index.js", "script.py", "Main.java", "lib.rs", "main.go"]) {
			const project = makeProject([{ path: marker }]);
			expect(detectRuntime(project.cwd, project.names)).toBeUndefined();
		}
	});

	it("prefers newly added tool-specific markers over legacy runtime markers", () => {
		const maven = makeProject([{ path: "pom.xml" }]);
		const gradle = makeProject([{ path: "build.gradle" }]);
		const xmake = makeProject([{ path: "xmake.lua" }]);

		expect(detectRuntime(maven.cwd, maven.names)?.name).toBe("maven");
		expect(detectRuntime(gradle.cwd, gradle.names)?.name).toBe("gradle");
		expect(detectRuntime(xmake.cwd, xmake.names)?.name).toBe("xmake");
	});

	it("keeps java reachable with a Java-specific marker", () => {
		const project = makeProject([{ path: ".java-version" }]);
		expect(detectRuntime(project.cwd, project.names)?.name).toBe("java");
	});

	it("detects lua from top-level lua directory", () => {
		const project = makeProject([{ path: "lua", dir: true }]);
		const runtime = detectRuntime(project.cwd, project.names);
		if (!runtime) throw new Error("expected runtime");
		expect(runtime.name).toBe("lua");
	});

	it.each([
		["buf", "buf.yaml"],
		["c", "hello.c"],
		["cpp", "hello.cpp"],
		["elixir", "mix.exs"],
		["gleam", "gleam.toml"],
		["julia", "Project.toml"],
		["opa", "policy.rego"],
		["pixi", "pixi.toml"],
		["swift", "Package.swift"],
		["xmake", "xmake.lua"],
		["zig", "build.zig"],
	])("detects %s projects from Starship markers", (name, marker) => {
		const project = makeProject([{ path: marker }]);
		const runtime = detectRuntime(project.cwd, project.names);
		if (!runtime) throw new Error("expected runtime");
		expect(runtime.name).toBe(name);
		expect(runtime.style).toBe("");
	});

	it.each([
		["conda", { CONDA_DEFAULT_ENV: "py312" }],
		["guix_shell", { GUIX_ENVIRONMENT: "/gnu/store/profile" }],
		["meson", { MESON_DEVENV: "1", MESON_PROJECT_NAME: "zentui" }],
		["nix_shell", { IN_NIX_SHELL: "pure" }],
		["spack", { SPACK_ENV: "dev" }],
	])("detects %s from Starship environment markers", (name, env) => {
		const project = makeProject([]);
		const runtime = detectRuntime(project.cwd, project.names, env);
		if (!runtime) throw new Error("expected runtime");
		expect(runtime.name).toBe(name);
		expect(runtime.style).toBe("");
	});
});

describe("readRuntimeInfo cache", () => {
	it("caches version probes for the same cwd + marker fingerprint", async () => {
		clearRuntimeInfoCache();
		const project = makeProject([{ path: "package.json" }]);

		const first = await readRuntimeInfo(project.cwd);
		const second = await readRuntimeInfo(project.cwd);
		expect(first).toEqual(second);
		expect(first.kind).toBe("ok");
		if (first.kind === "ok") {
			expect(first.runtime?.name).toBe("nodejs");
		}

		// Marker change busts cache and re-detects.
		writeFileSync(join(project.cwd, "bun.lock"), "", "utf8");
		const third = await readRuntimeInfo(project.cwd);
		expect(third.kind).toBe("ok");
		if (third.kind === "ok") {
			expect(third.runtime?.name).toBe("bun");
		}
	});

	it("returns error when cwd cannot be read", async () => {
		const result = await readRuntimeInfo(join(tmpdir(), "zentui-missing-runtime-dir-xyz"));
		expect(result).toEqual({ kind: "error" });
	});
});

describe.skipIf(process.platform === "win32")("runtime version probe recovery", () => {
	const roots: string[] = [];
	afterEach(() => {
		vi.restoreAllMocks();
		vi.unstubAllEnvs();
		clearRuntimeInfoCache();
		for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
	});
	function fixture(command = "node", marker = ".node-version") {
		clearRuntimeInfoCache();
		const root = mkdtempSync(join(tmpdir(), "zentui-version-probe-"));
		roots.push(root);
		const bin = join(root, "bin");
		const cwd = join(root, "B");
		mkdirSync(bin);
		mkdirSync(cwd);
		const executable = join(bin, command);
		const log = join(root, "calls");
		const setExecutable = (body: string) => {
			writeFileSync(executable, `#!/bin/sh\n${body}\n`);
			chmodSync(executable, 0o755);
		};
		setExecutable(`echo probe >> "${log}"; /bin/cat "${marker}"`);
		writeFileSync(join(cwd, marker), "v2.0.0");
		vi.stubEnv("PATH", `${bin}:${process.env.PATH}`);
		const calls = () => {
			try {
				return readFileSync(log, "utf8").trim().split("\n").length;
			} catch {
				return 0;
			}
		};
		return { root, cwd, marker, setExecutable, calls };
	}
	it.each([
		["node", ".node-version", "v2.0.0"],
		["python3", ".python-version", "Python 2.0.0"],
		["mvn", "pom.xml", "Apache Maven 2.0.0"],
	])("runs %s in requested B, not the process cwd A", async (command, marker, version) => {
		const f = fixture(command, marker);
		writeFileSync(join(f.cwd, marker), version);
		expect(f.cwd).not.toBe(process.cwd());
		expect(await readRuntimeInfo(f.cwd)).toMatchObject({
			kind: "ok",
			runtime: { version: "v2.0.0" },
		});
		expect(f.calls()).toBe(1);
	});
	it("reprobes edited markers immediately, expires positive results, and caches between polls", async () => {
		const f = fixture();
		let now = 1_000;
		vi.spyOn(Date, "now").mockImplementation(() => now);
		await readRuntimeInfo(f.cwd);
		await readRuntimeInfo(f.cwd);
		expect(f.calls()).toBe(1);
		writeFileSync(join(f.cwd, f.marker), "v33.0.0");
		expect(await readRuntimeInfo(f.cwd)).toMatchObject({ runtime: { version: "v33.0.0" } });
		expect(f.calls()).toBe(2);
		f.setExecutable("echo v4.0.0");
		now += 59_999;
		expect(await readRuntimeInfo(f.cwd)).toMatchObject({ runtime: { version: "v33.0.0" } });
		now += 1;
		expect(await readRuntimeInfo(f.cwd)).toMatchObject({ runtime: { version: "v4.0.0" } });
	});
	it("retries executable failure sooner than a positive result without reload", async () => {
		const f = fixture();
		let now = 1_000;
		vi.spyOn(Date, "now").mockImplementation(() => now);
		f.setExecutable("exit 1");
		expect(await readRuntimeInfo(f.cwd)).toMatchObject({
			runtime: { name: "nodejs", version: undefined },
		});
		f.setExecutable("echo v5.0.0");
		now += 4_999;
		expect(await readRuntimeInfo(f.cwd)).toMatchObject({ runtime: { version: undefined } });
		now += 1;
		expect(await readRuntimeInfo(f.cwd)).toMatchObject({ runtime: { version: "v5.0.0" } });
	});
	it("bounds a stalled executable to 2.5 seconds and recovers on retry", async () => {
		const f = fixture();
		let now = 1_000;
		vi.spyOn(Date, "now").mockImplementation(() => now);
		f.setExecutable("exec /bin/sleep 10");
		const start = performance.now();
		expect(await readRuntimeInfo(f.cwd)).toMatchObject({ runtime: { version: undefined } });
		expect(performance.now() - start).toBeGreaterThanOrEqual(2_400);
		expect(performance.now() - start).toBeLessThan(5_000);
		f.setExecutable("echo v6.0.0");
		now += 5_000;
		expect(await readRuntimeInfo(f.cwd)).toMatchObject({ runtime: { version: "v6.0.0" } });
	});
	it("evicts the oldest project after 32 entries", async () => {
		const f = fixture();
		vi.spyOn(Date, "now").mockReturnValue(1_000);
		await readRuntimeInfo(f.cwd);
		for (let index = 0; index < 32; index++) {
			const cwd = join(f.root, `project-${index}`);
			mkdirSync(cwd);
			writeFileSync(join(cwd, f.marker), "v2.0.0");
			await readRuntimeInfo(cwd);
		}
		expect(f.calls()).toBe(33);
		await readRuntimeInfo(f.cwd);
		expect(f.calls()).toBe(34);
	});
	it("keeps intentionally versionless runtime detection successful", async () => {
		const f = fixture();
		rmSync(join(f.cwd, f.marker));
		vi.stubEnv("CONDA_DEFAULT_ENV", "test");
		vi.stubEnv("PIXI_ENVIRONMENT_NAME", "");
		expect(await readRuntimeInfo(f.cwd)).toMatchObject({
			kind: "ok",
			runtime: { name: "conda", version: undefined },
		});
		expect(f.calls()).toBe(0);
		let now = 1_000;
		vi.spyOn(Date, "now").mockImplementation(() => now);
		clearRuntimeInfoCache();
		const first = await readRuntimeInfo(f.cwd);
		now += 5_000;
		const second = await readRuntimeInfo(f.cwd);
		if (first.kind === "ok" && second.kind === "ok") expect(second.runtime).toBe(first.runtime);
	});
});
