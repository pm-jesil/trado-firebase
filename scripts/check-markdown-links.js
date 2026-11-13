/**
 * @guard-scope: files **\/*.md (repository)
 * Trado Markdown Link Checker
 * 
 * Scans all documentation and README.md files to ensure all relative links
 * resolve to existing files on disk.
 */

const fs = require('node:fs');
const path = require('node:path');

const ROOT_DIR = path.resolve(__dirname, '..');

function getMarkdownFiles(dir) {
  let results = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const ent of entries) {
    if (ent.name === 'node_modules' || ent.name === '.git' || ent.name === 'lib' || ent.name === '.local') continue; // .local: runtime output, rewritten while units run
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      results = results.concat(getMarkdownFiles(full));
    } else if (ent.isFile() && ent.name.endsWith('.md')) {
      results.push(full);
    }
  }
  return results;
}

function checkLinksInFile(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  const dir = path.dirname(filePath);
  const lines = content.split('\n');
  const brokenLinks = [];

  // Match [text](target) - exclude image links if external or handle them
  const inlineLinkRegex = /\[([^\]]+)\]\(([^)]+)\)/g;

  lines.forEach((line, lineIdx) => {
    let match;
    while ((match = inlineLinkRegex.exec(line)) !== null) {
      const target = match[2].trim();
      // Skip web links, mailto, pure anchors, and custom protocols
      if (
        target.startsWith('http://') ||
        target.startsWith('https://') ||
        target.startsWith('mailto:') ||
        target.startsWith('#') ||
        target.startsWith('conversation://')
      ) {
        continue;
      }

      // Handle file:// absolute paths if present
      let targetPath = target;
      if (targetPath.startsWith('file:///')) {
        targetPath = targetPath.replace('file:///', '');
        // On Windows, fix drive letter like c:/ to C:/
        targetPath = decodeURIComponent(targetPath);
      }

      // Strip anchor #section from path
      const [basePath] = targetPath.split('#');
      if (!basePath) continue; // Pure anchor was already skipped

      // Resolve relative to current doc file
      const resolved = path.isAbsolute(basePath) 
        ? path.normalize(basePath)
        : path.resolve(dir, basePath);

      if (!fs.existsSync(resolved)) {
        brokenLinks.push({
          line: lineIdx + 1,
          target,
          resolved,
        });
      }
    }
  });

  return brokenLinks;
}

function run() {
  console.log('================================================================================');
  console.log('   TRADO DOCUMENTATION: MARKDOWN LINK INTEGRITY CHECKER                         ');
  console.log('================================================================================\n');

  const files = getMarkdownFiles(ROOT_DIR);
  console.log(`Discovered ${files.length} markdown documentation files.\n`);

  let totalBroken = 0;
  for (const file of files) {
    const relFile = path.relative(ROOT_DIR, file);
    const broken = checkLinksInFile(file);
    if (broken.length > 0) {
      console.log(`[FAIL] ${relFile}:`);
      broken.forEach(b => {
        console.log(`  Line ${b.line}: "${b.target}" -> File not found: ${b.resolved}`);
      });
      totalBroken += broken.length;
    }
  }

  if (totalBroken === 0) {
    console.log('[PASS] All markdown links across all documentation files resolve successfully! ✓\n');
    process.exit(0);
  } else {
    console.error(`\n[FAIL] Found ${totalBroken} broken markdown link(s).\n`);
    process.exit(1);
  }
}

run();

