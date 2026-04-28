"use client";

import { Loader2, Sparkles, Image as ImageIcon } from "lucide-react";
import { useEffect, useState, useTransition } from "react";
import Image from "next/image";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { generateCategoryIconAction, updateCategoryIconAction, listCategoriesAction } from "@/actions/finance";

export type CategoryOption = {
  id: string;
  name: string;
  kind: string;
  parentId: string | null;
  parentName: string | null;
  icon?: string | null;
};

const DEFAULT_ICONS = [
  "/icons/categories/housing.png",
  "/icons/categories/groceries.png",
  "/icons/categories/transportation.png",
  "/icons/categories/dining.png",
  "/icons/categories/shopping.png",
  "/icons/categories/other.png",
];

export function ToolsCategoriesTab({ active, onChanged }: { active: boolean; onChanged?: () => void }) {
  const [categories, setCategories] = useState<CategoryOption[]>([]);
  const [isPending, startTransition] = useTransition();

  const load = () => {
    listCategoriesAction().then(data => {
      if (data.ok) setCategories(data.categories);
    }).catch(() => {});
  };

  useEffect(() => {
    if (active) load();
  }, [active]);

  if (!active) return null;

  return (
    <div className="space-y-4 text-sm">
      <p className="text-xs text-muted-foreground">
        Manage your categories and customize their icons. You can choose from our default anime-style library or generate your own using AI!
      </p>
      {categories.length === 0 ? (
        <p className="text-xs text-muted-foreground">No categories yet.</p>
      ) : (
        <ul className="space-y-3">
          {categories.map((c) => (
            <CategoryRow key={c.id} category={c} isPending={isPending} startTransition={startTransition} onRefresh={() => { load(); onChanged?.(); }} />
          ))}
        </ul>
      )}
    </div>
  );
}

function CategoryRow({ category, isPending, startTransition, onRefresh }: { category: CategoryOption, isPending: boolean, startTransition: (fn: () => void) => void, onRefresh: () => void }) {
  const [editing, setEditing] = useState(false);
  const [prompt, setPrompt] = useState("");
  const [loading, setLoading] = useState(false);

  return (
    <li className="rounded-xl border bg-card p-3 text-xs shadow-sm space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-8 w-8 items-center justify-center overflow-hidden rounded-full bg-muted">
            {category.icon ? (
              <Image src={category.icon} alt={category.name} width={32} height={32} className="h-full w-full object-cover" />
            ) : (
              <ImageIcon className="h-4 w-4 text-muted-foreground" />
            )}
          </div>
          <div>
            <div className="font-medium text-foreground">{category.name}</div>
            <div className="text-[10px] text-muted-foreground">{category.parentName ? `${category.parentName} · ` : ""}{category.kind}</div>
          </div>
        </div>
        <Button variant="ghost" size="sm" onClick={() => setEditing(!editing)}>{editing ? "Close" : "Edit Icon"}</Button>
      </div>

      {editing && (
        <div className="pt-2 border-t mt-2 space-y-3">
          <div>
            <div className="text-[10px] font-semibold mb-2">Choose from library:</div>
            <div className="flex flex-wrap gap-2">
              {DEFAULT_ICONS.map((icon) => (
                <button
                  key={icon}
                  disabled={isPending || loading}
                  className="h-10 w-10 overflow-hidden rounded-md border hover:border-primary transition-colors"
                  onClick={() => {
                    setLoading(true);
                    startTransition(() => {
                      updateCategoryIconAction(category.id, icon).then(() => {
                        setLoading(false);
                        setEditing(false);
                        onRefresh();
                      });
                    });
                  }}
                >
                  <Image src={icon} alt="Icon" width={40} height={40} className="object-cover" />
                </button>
              ))}
            </div>
          </div>

          <div>
            <div className="text-[10px] font-semibold mb-2">Generate a custom icon with AI:</div>
            <div className="flex gap-2">
              <Input
                placeholder="Leave blank to use the category name, or describe the icon"
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                className="h-8 text-xs"
                disabled={isPending || loading}
              />
              <Button
                size="sm"
                className="h-8 gap-1"
                disabled={isPending || loading}
                onClick={() => {
                  setLoading(true);
                  startTransition(() => {
                    generateCategoryIconAction(category.id, prompt.trim()).then(() => {
                      setLoading(false);
                      setEditing(false);
                      onRefresh();
                    });
                  });
                }}
              >
                {loading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
                Generate icon
              </Button>
            </div>
            <div className="mt-1 text-[10px] text-muted-foreground">
              9router image creation will use the category name automatically if you don&apos;t type a prompt.
            </div>
          </div>
        </div>
      )}
    </li>
  );
}
