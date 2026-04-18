"use server";

import { redirect } from "next/navigation";
import { z } from "zod";

import { auth } from "@/auth";
import { ensureCategorySeed, replaceUserWallets } from "@/lib/finance/seed";
import { prisma } from "@/lib/prisma";

const CurrencyEnum = z.enum(["CAD", "USD", "EUR", "GBP", "VND"]);

export type OnboardingState = { error: string | null };

const RECOMMENDED = ["Main", "Savings", "Credit card"] as const;

export async function completeOnboardingAction(
  _prev: OnboardingState | undefined,
  formData: FormData,
): Promise<OnboardingState> {
  const session = await auth();
  if (!session?.user?.id) {
    return { error: "Phiên đăng nhập hết hạn — đăng nhập lại nhé." };
  }

  const userId = session.user.id;
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { onboardingCompleted: true },
  });
  if (user?.onboardingCompleted) {
    redirect("/");
  }

  const mode = formData.get("mode");
  const currencyRaw = formData.get("currency");
  const namesRaw = String(formData.get("walletNames") ?? "").trim();

  const currencyParsed = CurrencyEnum.safeParse(currencyRaw);
  if (!currencyParsed.success) {
    return { error: "Chọn loại tiền hợp lệ." };
  }
  const currency = currencyParsed.data;

  let walletNames: string[] = [];
  if (mode === "recommended") {
    walletNames = [...RECOMMENDED];
  } else if (mode === "custom") {
    try {
      const parsed = JSON.parse(namesRaw) as unknown;
      if (!Array.isArray(parsed)) {
        return { error: "Danh sách tên ví không hợp lệ." };
      }
      walletNames = parsed.map((x) => String(x).trim()).filter(Boolean);
    } catch {
      return { error: "Danh sách tên ví không hợp lệ." };
    }
    if (walletNames.length < 1 || walletNames.length > 5) {
      return { error: "Số ví từ 1 đến 5." };
    }
    const unique = new Set(walletNames.map((n) => n.toLowerCase()));
    if (unique.size !== walletNames.length) {
      return { error: "Mỗi ví cần một tên khác nhau." };
    }
  } else {
    return { error: "Chọn kiểu thiết lập ví." };
  }

  const txCount = await prisma.transaction.count({ where: { userId } });
  if (txCount > 0) {
    await prisma.user.update({
      where: { id: userId },
      data: {
        onboardingCompleted: true,
        preferredCurrency: currency,
      },
    });
    redirect("/");
  }

  await ensureCategorySeed(prisma, userId);
  await replaceUserWallets(prisma, userId, {
    names: walletNames,
    currency,
  });

  await prisma.user.update({
    where: { id: userId },
    data: {
      onboardingCompleted: true,
      preferredCurrency: currency,
    },
  });

  redirect("/");
}
