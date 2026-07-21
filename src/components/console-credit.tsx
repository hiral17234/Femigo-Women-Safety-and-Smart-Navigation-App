'use client';
import { useEffect } from "react";

export function ConsoleCredit() {
  useEffect(() => {
    console.log(
      '%c🚀 FEMIGO %c\n%cAll rights reserved © Hiral Goyal\nBuilt solely by Hiral Goyal\nGitHub: github.com/hiral17234',
      'color: #fff; background: #6366f1; font-size: 20px; font-weight: bold; padding: 8px 16px; border-radius: 4px;',
      '',
      'color: #6366f1; font-size: 13px; font-weight: bold; line-height: 1.6;'
    );
  }, []);

  return null;
}
