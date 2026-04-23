import type { CategoryKind, FlowDirection, PrismaClient } from "@prisma/client";

import { slugify } from "@/lib/finance/slug";

type CategoryRow = {
  id: string;
  name: string;
  slug: string;
  kind: CategoryKind;
  parentId: string | null;
  parent: { id: string; name: string; slug: string } | null;
  sortOrder: number;
};

function normalizeLabel(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value
    .replace(/[→›]/g, ">")
    .replace(/\s+/g, " ")
    .trim();
  return trimmed.length > 0 ? trimmed : null;
}

function categoryPathParts(value: string): string[] {
  return value
    .split(">")
    .map((part) => part.trim())
    .filter(Boolean);
}

function kindFromHints(args: {
  direction?: FlowDirection | null;
  payeeKind?: string | null;
  kindHint?: CategoryKind | null;
}): CategoryKind {
  if (args.kindHint) return args.kindHint;
  const payee = args.payeeKind?.trim().toLowerCase() ?? "";
  if (payee.includes("transfer")) return "transfer";
  if (args.direction === "in") return "income";
  return "expense";
}

async function loadCategories(db: PrismaClient, userId: string): Promise<CategoryRow[]> {
  return db.category.findMany({
    where: { userId },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    select: {
      id: true,
      name: true,
      slug: true,
      kind: true,
      parentId: true,
      parent: { select: { id: true, name: true, slug: true } },
      sortOrder: true,
    },
  });
}

function findByNameOrSlug(categories: CategoryRow[], value: string, kind?: CategoryKind): CategoryRow | null {
  const slug = slugify(value);
  const lowered = value.toLowerCase();
  return (
    categories.find(
      (category) =>
        (!kind || category.kind === kind) &&
        (category.name.toLowerCase() === lowered || category.slug === slug),
    ) ?? null
  );
}

function findByPath(categories: CategoryRow[], label: string, kind?: CategoryKind): CategoryRow | null {
  const lowered = label.toLowerCase();
  return (
    categories.find((category) => {
      if (kind && category.kind !== kind) return false;
      const path = category.parent ? `${category.parent.name} > ${category.name}` : category.name;
      return path.toLowerCase() === lowered;
    }) ?? null
  );
}

function nextUniqueSlug(existingSlugs: Set<string>, base: string): string {
  let slug = slugify(base);
  if (!existingSlugs.has(slug)) return slug;
  let index = 2;
  while (existingSlugs.has(`${slug}-${index}`)) {
    index += 1;
  }
  return `${slug}-${index}`;
}

async function createCategory(args: {
  db: PrismaClient;
  userId: string;
  name: string;
  kind: CategoryKind;
  parentId?: string | null;
  slugBase: string;
  existingSlugs: Set<string>;
}): Promise<CategoryRow> {
  const maxSort = await args.db.category.aggregate({
    where: { userId: args.userId },
    _max: { sortOrder: true },
  });
  const slug = nextUniqueSlug(args.existingSlugs, args.slugBase);
  args.existingSlugs.add(slug);
  return args.db.category.create({
    data: {
      userId: args.userId,
      name: args.name,
      slug,
      kind: args.kind,
      parentId: args.parentId ?? null,
      sortOrder: (maxSort._max.sortOrder ?? 0) + 1,
    },
    select: {
      id: true,
      name: true,
      slug: true,
      kind: true,
      parentId: true,
      parent: { select: { id: true, name: true, slug: true } },
      sortOrder: true,
    },
  });
}

export async function findOrCreateCategory(args: {
  db: PrismaClient;
  userId: string;
  label?: string | null;
  direction?: FlowDirection | null;
  payeeKind?: string | null;
  kindHint?: CategoryKind | null;
  fallbackSlug?: string;
}): Promise<CategoryRow | null> {
  const normalized = normalizeLabel(args.label);
  const fallbackSlug = args.fallbackSlug ?? "other";
  const kind = kindFromHints(args);
  const categories = await loadCategories(args.db, args.userId);

  if (!normalized) {
    return (
      categories.find((category) => category.slug === fallbackSlug) ??
      categories.find((category) => category.kind === kind) ??
      categories[0] ??
      null
    );
  }

  const directHit = findByPath(categories, normalized, kind) ?? findByNameOrSlug(categories, normalized, kind);
  if (directHit) return directHit;

  const parts = categoryPathParts(normalized);
  const existingSlugs = new Set(categories.map((category) => category.slug));

  if (parts.length >= 2) {
    const parentName = parts[0];
    const childName = parts[parts.length - 1];
    const parent =
      findByNameOrSlug(categories.filter((category) => !category.parentId), parentName, kind) ??
      (await createCategory({
        db: args.db,
        userId: args.userId,
        name: parentName,
        kind,
        slugBase: parentName,
        existingSlugs,
      }));

    const childHit =
      categories.find(
        (category) =>
          category.parentId === parent.id &&
          category.kind === kind &&
          category.name.toLowerCase() === childName.toLowerCase(),
      ) ?? null;
    if (childHit) return childHit;

    return createCategory({
      db: args.db,
      userId: args.userId,
      name: childName,
      kind,
      parentId: parent.id,
      slugBase: `${parent.name}-${childName}`,
      existingSlugs,
    });
  }

  return createCategory({
    db: args.db,
    userId: args.userId,
    name: normalized,
    kind,
    slugBase: normalized,
    existingSlugs,
  });
}
