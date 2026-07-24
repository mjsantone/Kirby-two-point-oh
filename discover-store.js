import { BlobServiceClient } from "@azure/storage-blob";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const LOCAL_DIR = path.join(ROOT, "data", "discover");
const AZURE_PREFIX = "items/";
const CONTAINER_NAME = process.env.AZURE_STORAGE_CONTAINER || "fuse-discover";
const CONNECTION_STRING = process.env.AZURE_STORAGE_CONNECTION_STRING;

let containerPromise = null;

function encodeMetadata(value, maxLength = 1000) {
  return encodeURIComponent(String(value || "").slice(0, maxLength));
}

function decodeMetadata(value) {
  try {
    return decodeURIComponent(value || "");
  } catch {
    return value || "";
  }
}

function toPublicItem(metadata) {
  return {
    id: metadata.id,
    title: decodeMetadata(metadata.title) || "Untitled fusion",
    kind: metadata.kind,
    directive: decodeMetadata(metadata.directive),
    outputType: decodeMetadata(metadata.outputtype) || "auto",
    createdAt: metadata.createdat,
    contentUrl: `/api/discover/${metadata.id}/content`,
  };
}

function toStorageMetadata(item) {
  return {
    id: item.id,
    title: encodeMetadata(item.title, 120),
    kind: item.kind,
    directive: encodeMetadata(item.directive, 500),
    outputtype: encodeMetadata(item.outputType, 80),
    createdat: item.createdAt,
  };
}

async function getAzureContainer() {
  if (!CONNECTION_STRING) return null;
  if (!containerPromise) {
    containerPromise = (async () => {
      const service = BlobServiceClient.fromConnectionString(CONNECTION_STRING);
      const container = service.getContainerClient(CONTAINER_NAME);
      await container.createIfNotExists();
      return container;
    })();
  }
  return containerPromise;
}

async function ensureLocalDirectory() {
  await mkdir(LOCAL_DIR, { recursive: true });
}

export function discoverStorageMode() {
  return CONNECTION_STRING ? "azure" : "local";
}

export async function saveDiscoverItem(item, content) {
  const metadata = toStorageMetadata(item);
  const container = await getAzureContainer();
  if (container) {
    const blob = container.getBlockBlobClient(`${AZURE_PREFIX}${item.id}`);
    await blob.uploadData(content, {
      blobHTTPHeaders: { blobContentType: item.contentType },
      metadata,
    });
    return toPublicItem(metadata);
  }

  await ensureLocalDirectory();
  await Promise.all([
    writeFile(path.join(LOCAL_DIR, `${item.id}.bin`), content),
    writeFile(path.join(LOCAL_DIR, `${item.id}.json`), JSON.stringify({ ...metadata, contentType: item.contentType })),
  ]);
  return toPublicItem(metadata);
}

export async function listDiscoverItems(limit = 48) {
  const container = await getAzureContainer();
  const items = [];

  if (container) {
    for await (const blob of container.listBlobsFlat({
      prefix: AZURE_PREFIX,
      includeMetadata: true,
    })) {
      if (!blob.metadata?.id) continue;
      items.push(toPublicItem(blob.metadata));
    }
  } else {
    await ensureLocalDirectory();
    const names = await readdir(LOCAL_DIR);
    const metadataFiles = names.filter((name) => name.endsWith(".json"));
    const records = await Promise.all(
      metadataFiles.map(async (name) => JSON.parse(await readFile(path.join(LOCAL_DIR, name), "utf8")))
    );
    items.push(...records.map(toPublicItem));
  }

  return items
    .filter((item) => item.id && item.createdAt && (item.kind === "html" || item.kind === "image"))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, limit);
}

export async function getDiscoverContent(id) {
  const container = await getAzureContainer();
  if (container) {
    const blob = container.getBlockBlobClient(`${AZURE_PREFIX}${id}`);
    const exists = await blob.exists();
    if (!exists) return null;
    const properties = await blob.getProperties();
    return {
      content: await blob.downloadToBuffer(),
      contentType: properties.contentType || "application/octet-stream",
      item: properties.metadata?.id ? toPublicItem(properties.metadata) : null,
    };
  }

  try {
    const [content, metadataRaw] = await Promise.all([
      readFile(path.join(LOCAL_DIR, `${id}.bin`)),
      readFile(path.join(LOCAL_DIR, `${id}.json`), "utf8"),
    ]);
    const metadata = JSON.parse(metadataRaw);
    return {
      content,
      contentType: metadata.contentType || "application/octet-stream",
      item: toPublicItem(metadata),
    };
  } catch (err) {
    if (err?.code === "ENOENT") return null;
    throw err;
  }
}