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

// 经典模式：使用固定英文名字池
const CLASSIC_FIRST_NAMES = [
    "Ethan", "Noah", "Liam", "Mason", "Lucas",
    "Logan", "Owen", "Ryan", "Leo", "Adam",
    "Ella", "Ava", "Mia", "Luna", "Chloe",
    "Grace", "Ruby", "Nora", "Ivy", "Sofia",
    "James", "Oliver", "Benjamin", "Elijah", "William",
    "Henry", "Alexander", "Daniel", "Michael", "Sebastian",
    "Emma", "Charlotte", "Amelia", "Harper", "Evelyn",
    "Abigail", "Emily", "Elizabeth", "Sofia", "Avery",
    "Jackson", "Aiden", "Matthew", "Samuel", "David",
    "Joseph", "Carter", "Jayden", "Luke", "Gabriel",
    "Scarlett", "Victoria", "Madison", "Layla", "Penelope",
    "Riley", "Zoey", "Nora", "Lily", "Eleanor",
    "Hannah", "Lillian", "Addison", "Aubrey", "Ellie",
    "Stella", "Natalie", "Zoe", "Leah", "Hazel",
    "Violet", "Aurora", "Savannah", "Audrey", "Brooklyn",
    "Bella", "Claire", "Skylar", "Lucy", "Paisley",
    "Isaac", "Jack", "Wyatt", "Dylan", "Nathan",
];
const CLASSIC_LAST_NAMES = [
    "Smith", "Brown", "Taylor", "Walker", "Wilson",
    "Clark", "Hall", "Young", "Allen", "King",
    "Scott", "Green", "Baker", "Adams", "Turner",
    "Johnson", "Williams", "Jones", "Davis", "Miller",
    "Moore", "Jackson", "Martin", "Lee", "Thompson",
    "White", "Harris", "Lewis", "Robinson", "Clark",
    "Rodriguez", "Lewis", "Lee", "Walker", "Hall",
    "Allen", "Young", "Hernandez", "King", "Wright",
    "Lopez", "Hill", "Scott", "Green", "Adams",
    "Baker", "Gonzalez", "Nelson", "Carter", "Mitchell",
    "Perez", "Roberts", "Turner", "Phillips", "Campbell",
    "Parker", "Evans", "Edwards", "Collins", "Stewart",
    "Sanchez", "Morris", "Rogers", "Reed", "Cook",
    "Morgan", "Bell", "Murphy", "Bailey", "Rivera",
    "Cooper", "Richardson", "Cox", "Howard", "Ward",
    "Torres", "Peterson", "Gray", "Ramirez", "James",
    "Watson", "Brooks", "Kelly", "Sanders", "Price",
    "Bennett", "Wood", "Barnes", "Ross", "Henderson",
    "Coleman", "Jenkins", "Perry", "Powell", "Long",
    "Patterson", "Hughes", "Flores", "Washington", "Butler",
];

function pick<T>(arr: T[]): T {
    return arr[Math.floor(Math.random() * arr.length)];
}

function randomInt(min: number, max: number): number {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

function generateClassicProfile(): {name: string; birthdate: string} {
    const age = randomInt(appConfig.profileAgeMin, appConfig.profileAgeMax);
    const today = new Date();
    const birthYear = today.getFullYear() - age;
    const birthMonth = randomInt(1, 12);
    const maxDay = new Date(birthYear, birthMonth, 0).getDate();
    const birthDay = randomInt(1, maxDay);
    const birthdate = `${birthYear}-${String(birthMonth).padStart(2, "0")}-${String(birthDay).padStart(2, "0")}`;

    return {
        name: `${pick(CLASSIC_FIRST_NAMES)} ${pick(CLASSIC_LAST_NAMES)}`,
        birthdate,
    };
}

export async function resolveProfileLocale(): Promise<{locale: string; source: string; country?: string}> {
    const requested = String(appConfig.profileLocale ?? "auto").trim();

    // 经典模式：使用固定英文名字池，不依赖 IP 检测
    if (requested.toLowerCase() === "classic") {
        return {locale: "classic", source: "config"};
    }

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

    // 经典模式：使用固定英文名字池
    if (locale === "classic") {
        console.log(`[profile] 使用经典模式（固定英文名字池）`);
        return generateClassicProfile();
    }

    const faker = resolveFakerByLocale(locale);
    const birthdate = randomBirthdate(appConfig.profileAgeMin, appConfig.profileAgeMax);
    return {
        name: faker.person.fullName(),
        birthdate: formatBirthdate(birthdate),
    };
}
