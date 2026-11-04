import "server-only";
import { readFile } from "node:fs/promises";
import { MemoryRepo, type FixtureData } from "./memory";

let cache: { path: string; repo: MemoryRepo } | null = null;

export const FixtureRepo = {
  async load(path: string): Promise<MemoryRepo> {
    if (cache?.path === path) return cache.repo;
    const data = JSON.parse(await readFile(path, "utf8")) as FixtureData;
    const repo = new MemoryRepo(data);
    cache = { path, repo };
    return repo;
  },
};
