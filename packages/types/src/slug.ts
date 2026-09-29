// URL slugs for clubs, venues and tournaments. Cyrillic names are transliterated
// ("Главный зал" → "glavnyy-zal") instead of being dropped, so Russian-speaking
// clubs get readable links and never an empty slug.

const CYRILLIC: Record<string, string> = {
  а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ё: "e", ж: "zh", з: "z", и: "i", й: "y", к: "k", л: "l", м: "m",
  н: "n", о: "o", п: "p", р: "r", с: "s", т: "t", у: "u", ф: "f", х: "kh", ц: "ts", ч: "ch", ш: "sh", щ: "shch",
  ъ: "", ы: "y", ь: "", э: "e", ю: "yu", я: "ya", і: "i", ї: "yi", є: "ye", ґ: "g", ў: "u",
};

export function slugify(input: string, maxLength = 50): string {
  let out = "";
  for (const ch of input.toLowerCase()) out += CYRILLIC[ch] ?? ch;
  return out
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "") // accents: "café" → "cafe"
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, maxLength)
    .replace(/-+$/g, "");
}
