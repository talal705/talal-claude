import type { CodeTrack } from "@ytl/contracts";

export const TRACKS: { id: CodeTrack; name: string; file: string; samples: readonly string[] }[] = [
  { id: "html_css", name: "HTML + CSS", file: "index.html", samples: [
    '<!doctype html>\n<html lang="en">\n<style>\n  body { font-family: system-ui; padding: 32px; background: #10131a; color: white; }\n  h1 { color: #22d3ee; }\n</style>\n<h1>Hello, Tech Lab!</h1>\n<p>This is my first page.</p>\n</html>',
    '<!doctype html>\n<style>\n  body { font-family: system-ui; padding: 30px; }\n  .card { padding: 24px; border-radius: 16px; background: #12305c; color: white; }\n</style>\n<article class="card"><h1>My project</h1><p>Built by me.</p></article>',
    '<!doctype html>\n<style>\n  body { font-family: system-ui; padding: 24px; }\n  .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(120px, 1fr)); gap: 16px; }\n  article { background: #ddf7fc; padding: 24px; border-radius: 12px; }\n</style>\n<h1>My projects</h1>\n<div class="grid"><article>PC</article><article>Code</article><article>Network</article></div>',
    '<!doctype html>\n<style>\n  body { font-family: system-ui; max-width: 600px; margin: auto; padding: 24px; }\n  input, button { padding: 12px; margin: 8px 0; }\n  input:focus-visible, button:focus-visible { outline: 3px solid #0891b2; }\n</style>\n<h1>Join my club</h1>\n<form><label for="name">Your name</label><br><input id="name" required><br><button>Join</button></form>'
  ] },
  { id: "javascript", name: "JavaScript", file: "main.js", samples: [
    'const name = "Tech Lab";\nconsole.log("Hello, " + name + "!");',
    'function add(a, b) {\n  return a + b;\n}\nconsole.log(add(8, 12));',
    'const scores = [30, 75, 90, 45];\nconst passed = scores.filter(score => score >= 60);\nconsole.log(passed);',
    'async function loadProfile() {\n  const profile = await Promise.resolve({ name: "Learner", points: 50 });\n  return `${profile.name}: ${profile.points} points`;\n}\nloadProfile().then(console.log);'
  ] },
  { id: "typescript", name: "TypeScript", file: "main.ts", samples: [
    'const learnerName: string = "Tech Lab";\nconsole.log(`Hello, ${learnerName}!`);',
    'function total(price: number, count: number): number {\n  return price * count;\n}\nconsole.log(total(12, 3));',
    'type Part = { name: string; installed: boolean };\nconst parts: Part[] = [{ name: "RAM", installed: true }];\nconsole.log(parts.filter(part => part.installed));',
    'type Result<T> = { ok: true; value: T } | { ok: false; error: string };\nfunction double(input: number): Result<number> {\n  return input >= 0 ? { ok: true, value: input * 2 } : { ok: false, error: "Use a positive number" };\n}\nconsole.log(double(10));'
  ] },
  { id: "python", name: "Python", file: "main.py", samples: [
    'name = "Tech Lab"\nprint("Hello, " + name + "!")',
    'def add(a, b):\n    return a + b\n\nprint(add(8, 12))',
    'scores = [30, 75, 90, 45]\npassed = [score for score in scores if score >= 60]\nprint(passed)',
    'class Part:\n    def __init__(self, name):\n        self.name = name\n        self.installed = False\n\n    def install(self):\n        self.installed = True\n\nram = Part("RAM")\nram.install()\nprint(ram.name, ram.installed)'
  ] },
  { id: "cpp", name: "C++", file: "main.cpp", samples: [
    '#include <iostream>\nint main() {\n    std::cout << "Hello, Tech Lab!" << std::endl;\n    return 0;\n}',
    '#include <iostream>\nint add(int a, int b) { return a + b; }\nint main() { std::cout << add(8, 12) << std::endl; }',
    '#include <iostream>\n#include <vector>\nint main() {\n    std::vector<int> scores = {30, 75, 90, 45};\n    for (int score : scores) if (score >= 60) std::cout << score << " ";\n}',
    '#include <iostream>\n#include <string>\nclass Part {\npublic:\n    std::string name;\n    bool installed = false;\n    void install() { installed = true; }\n};\nint main() { Part ram; ram.name = "RAM"; ram.install(); std::cout << ram.name << " " << ram.installed; }'
  ] },
  { id: "csharp", name: "C#", file: "Program.cs", samples: [
    'using System;\nConsole.WriteLine("Hello, Tech Lab!");',
    'using System;\nint Add(int a, int b) => a + b;\nConsole.WriteLine(Add(8, 12));',
    'using System;\nusing System.Linq;\nint[] scores = {30, 75, 90, 45};\nConsole.WriteLine(string.Join(", ", scores.Where(score => score >= 60)));',
    'using System;\nvar ram = new Part("RAM");\nram.Install();\nConsole.WriteLine($"{ram.Name}: {ram.Installed}");\nclass Part(string name) {\n    public string Name = name;\n    public bool Installed;\n    public void Install() => Installed = true;\n}'
  ] },
  { id: "java", name: "Java", file: "Main.java", samples: [
    'public class Main {\n    public static void main(String[] args) {\n        System.out.println("Hello, Tech Lab!");\n    }\n}',
    'public class Main {\n    static int add(int a, int b) { return a + b; }\n    public static void main(String[] args) { System.out.println(add(8, 12)); }\n}',
    'public class Main {\n    public static void main(String[] args) {\n        int[] scores = {30, 75, 90, 45};\n        for (int score : scores) if (score >= 60) System.out.println(score);\n    }\n}',
    'public class Main {\n    static class Part {\n        String name; boolean installed;\n        Part(String name) { this.name = name; }\n        void install() { installed = true; }\n    }\n    public static void main(String[] args) {\n        Part ram = new Part("RAM"); ram.install();\n        System.out.println(ram.name + ": " + ram.installed);\n    }\n}'
  ] },
];

export const CODE_SAVE_KEY = "ytl_learning_code_v1";
export const MAX_CODE_LENGTH = 12_000;

/** Narrow, deterministic typo suggestions. Never presented as a model's answer. */
export function suggestTypo(track: CodeTrack, code: string): { code: string; line: number; token: string } | null {
  const rules: Partial<Record<CodeTrack, [RegExp, string]>> = {
    javascript: [/\bconsole\.lg\s*\(/, "console.log("],
    typescript: [/\bconsole\.lg\s*\(/, "console.log("],
    python: [/\bpritn\s*\(/, "print("],
    csharp: [/\bConsole\.Writeline\s*\(/, "Console.WriteLine("],
    java: [/\bSystem\.out\.printLine\s*\(/, "System.out.println("],
    cpp: [/\bstd::count\s*<</, "std::cout <<"],
  };
  const rule = rules[track];
  if (!rule) return null;
  const match = rule[0].exec(code);
  if (!match) return null;
  // Avoid rewriting a literal or comment. Offer only a standalone code statement.
  const prefix = code.slice(code.lastIndexOf("\n", match.index - 1) + 1, match.index);
  if (/['"`#]|\/\/|\/\*/.test(prefix)) return null;
  return { code: code.replace(rule[0], rule[1]), line: code.slice(0, match.index).split("\n").length, token: rule[1] };
}
