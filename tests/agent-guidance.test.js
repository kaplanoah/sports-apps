import test from "node:test";
import assert from "node:assert/strict";
import {
  existsSync,
  lstatSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  realpathSync,
} from "node:fs";
import { REPO_ROOT, readRepoFile } from "./repo-files.js";

const skills = readdirSync(new URL(".agents/skills/", REPO_ROOT));

test("every canonical skill is reachable through the Claude directory symlink", () => {
  const alias = new URL(".claude/skills", REPO_ROOT);
  assert.ok(lstatSync(alias).isSymbolicLink());
  assert.equal(readlinkSync(alias), "../.agents/skills");
  assert.ok(skills.length > 0);
  for (const name of skills) {
    const canonical = new URL(`.agents/skills/${name}/SKILL.md`, REPO_ROOT);
    const claude = new URL(`.claude/skills/${name}/SKILL.md`, REPO_ROOT);
    assert.equal(realpathSync(claude), realpathSync(canonical));
    assert.equal(readFileSync(claude, "utf8"), readFileSync(canonical, "utf8"));
  }
});

test("skill frontmatter contains only its name and description", () => {
  for (const name of skills) {
    const text = readRepoFile(`.agents/skills/${name}/SKILL.md`);
    const metadata = text.match(/^---\n([\s\S]*?)\n---\n/)?.[1];
    assert.ok(metadata, name);
    assert.deepEqual([...metadata.matchAll(/^(\S+):/gm)].map((match) => match[1]).sort(), [
      "description",
      "name",
    ]);
    assert.match(metadata, new RegExp(`^name: ${name}$`, "m"));
    assert.match(metadata, /^description: .+/m);
  }
});

test("AGENTS names every skill and rule by an existing full path with a reading condition", () => {
  const agents = readRepoFile("AGENTS.md");
  const paths = [
    ...skills.map((name) => `.agents/skills/${name}/SKILL.md`),
    ...readdirSync(new URL(".claude/rules/", REPO_ROOT))
      .filter((name) => name.endsWith(".md"))
      .map((name) => `.claude/rules/${name}`),
  ];
  for (const path of paths) {
    assert.ok(
      agents
        .split("\n")
        .some((line) => line.includes(`\`${path}\``) && /(?:before|for) /.test(line)),
      path,
    );
  }
  const named = [...agents.matchAll(/`((?:\.agents\/skills|\.claude\/rules)\/[^`]+\.md)`/g)].map(
    (match) => match[1],
  );
  assert.ok(named.length >= paths.length);
  for (const path of named) assert.ok(existsSync(new URL(path, REPO_ROOT)), path);
});
