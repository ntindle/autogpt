import { getGetWorkspaceDownloadFileByIdUrl } from "@/app/api/__generated__/endpoints/workspace/workspace";

interface MarkdownNode {
  type: string;
  value?: string;
  url?: string;
  children?: MarkdownNode[];
}

interface Options {
  fileUrls?: Record<string, string>;
}

const UUID = "[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}";
const URI = `workspace://(${UUID})(?:#[a-z][\\w.+-]*/[\\w.+-]+)?`;
const WORKSPACE_URI = new RegExp(`^${URI}$`, "i");
const WORKSPACE_REFERENCE = new RegExp(
  `(?:([\\w.-]+\\.[a-z0-9]+)([ \\t]+\\([^\\n)]*\\))?[ \\t]+[—–-][ \\t]+)?(?<![\\w/])${URI}(?![\\w/-])`,
  "gi",
);

function defaultFileUrl(fileID: string) {
  return `/api/proxy${getGetWorkspaceDownloadFileByIdUrl(fileID)}`;
}

function linkifyText(
  value: string,
  fileUrlBuilder: (fileID: string) => string,
) {
  const nodes: MarkdownNode[] = [];
  let offset = 0;
  for (const match of value.matchAll(WORKSPACE_REFERENCE)) {
    const [reference, filename, version, fileID] = match;
    const start = match.index;
    if (start > offset)
      nodes.push({ type: "text", value: value.slice(offset, start) });
    nodes.push({
      type: "link",
      url: fileUrlBuilder(fileID),
      children: [{ type: "text", value: filename || "Open file" }],
    });
    if (version) nodes.push({ type: "text", value: version });
    offset = start + reference.length;
  }
  if (offset < value.length)
    nodes.push({ type: "text", value: value.slice(offset) });
  return nodes;
}

export function workspaceFileUrls(
  text: string,
  fileUrlBuilder?: (fileID: string) => string,
) {
  if (!fileUrlBuilder) return undefined;
  return Object.fromEntries(
    [...text.matchAll(new RegExp(URI, "gi"))].map((match) => [
      match[1],
      fileUrlBuilder(match[1]),
    ]),
  );
}

export function remarkWorkspaceLinks({ fileUrls = {} }: Options = {}) {
  function fileUrlBuilder(fileID: string) {
    return fileUrls[fileID] ?? defaultFileUrl(fileID);
  }
  return function transform(tree: MarkdownNode) {
    function visit(node: MarkdownNode) {
      if (
        node.type === "link" ||
        node.type === "image" ||
        node.type === "definition"
      ) {
        const match = node.url?.match(WORKSPACE_URI);
        if (match) node.url = fileUrlBuilder(match[1]);
        return;
      }
      if (node.type === "linkReference" || !node.children) return;
      node.children = node.children.flatMap((child) => {
        if (child.type === "text" && child.value?.includes("workspace://")) {
          const linked = linkifyText(child.value, fileUrlBuilder);
          return linked.some((part) => part.type === "link") ? linked : [child];
        }
        visit(child);
        return [child];
      });
    }
    visit(tree);
  };
}
