"use client";

import { useTranslations } from "next-intl";
import type { AvatarStyle } from "@ytl/contracts";

export const AVATARS = ["none", "boy", "man", "girl", "woman"] as const satisfies readonly AvatarStyle[];

/** Radio group for the avatar. `name` must be unique per instance on the page. */
export function AvatarPicker({
  name,
  value,
  disabled,
  onChange,
}: {
  name: string;
  value: AvatarStyle;
  disabled?: boolean;
  onChange: (avatar: AvatarStyle) => void;
}) {
  const t = useTranslations("settings.avatar");
  return (
    <fieldset className="settings-group" disabled={disabled}>
      <legend>{t("legend")}</legend>
      <div className="option-row">
        {AVATARS.map((avatar) => (
          <label key={avatar} className="settings-option">
            <input
              type="radio"
              name={name}
              value={avatar}
              checked={value === avatar}
              onChange={() => onChange(avatar)}
            />
            <span>{t(avatar)}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}
