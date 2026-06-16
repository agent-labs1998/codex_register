import {appConfig} from "./config.js";
import {
    fakerEN_US,
    fakerEN_GB,
    fakerJA,
    fakerES,
    fakerPT_BR,
    fakerFR,
    fakerDE,
    type Faker,
} from "@faker-js/faker";
import {getProfileCountryByRegistrationProxy} from "./profile-geo.js";

const LOCALE_MAP: Record<string, Faker> = {
    en_us: fakerEN_US,
    en_usa: fakerEN_US,
    us: fakerEN_US,
    en_gb: fakerEN_GB,
    gb: fakerEN_GB,
    en_gb_gb: fakerEN_GB,
    ja: fakerJA,
    ja_jp: fakerJA,
    jp: fakerJA,
    es: fakerES,
    es_es: fakerES,
    co: fakerES,
    cl: fakerES,
    pt_br: fakerPT_BR,
    br: fakerPT_BR,
    fr: fakerFR,
    fr_fr: fakerFR,
    de: fakerDE,
    de_de: fakerDE,
};

function normalizeLocaleKey(value: string): string {
    return value.trim().toLowerCase().replace(/[^a-z0-9]/g, "_");
}

function resolveFakerByLocale(locale: string): Faker {
    const key = normalizeLocaleKey(locale);
    return LOCALE_MAP[key] ?? LOCALE_MAP["en_us"] ?? fakerEN_US;
}

function randomBirthdate(minAge: number, maxAge: number): Date {
    const today = new Date();
    const minSafe = Math.min(minAge, maxAge);
    const maxSafe = Math.max(minAge, maxAge);
    return fakerEN_US.date.birthdate({
        min: minSafe,
        max: maxSafe,
        mode: "age",
    });
}

function formatBirthdate(date: Date): string {
    const y = date.getFullYear();
    const m = `${date.getMonth() + 1}`.padStart(2, "0");
    const d = `${date.getDate()}`.padStart(2, "0");
    return `${y}-${m}-${d}`;
}

function mapCountryToLocale(countryCode: string): string {
    const normalized = countryCode.trim().toUpperCase();
    return appConfig.profileLocaleByCountry[normalized] ?? "en_US";
}

export async function resolveProfileLocale(): Promise<{locale: string; source: string; country?: string}> {
    const requested = String(appConfig.profileLocale ?? "auto").trim();
    if (requested && requested.toLowerCase() !== "auto") {
        return {locale: requested, source: "config"};
    }

    try {
        const result = await getProfileCountryByRegistrationProxy();
        const locale = mapCountryToLocale(result.country);
        console.log(`[profile-geo] country=${result.country} locale=${locale} source=${result.source}`);
        return {locale, source: result.source, country: result.country};
    } catch (error) {
        const fallbackLocale = "en_US";
        console.warn(`[profile-geo] 自动检测失败，回退到 ${fallbackLocale}: ${(error as Error).message}`);
        return {locale: fallbackLocale, source: "fallback"};
    }
}

export async function generateRegistrationProfile(): Promise<{name: string; birthdate: string}> {
    const {locale} = await resolveProfileLocale();
    const faker = resolveFakerByLocale(locale);
    const birthdate = randomBirthdate(appConfig.profileAgeMin, appConfig.profileAgeMax);
    return {
        name: faker.person.fullName(),
        birthdate: formatBirthdate(birthdate),
    };
}
