"use client";
import { Icon } from "@/components/Icons";
import styles from "./Groups.module.css";

export type GroupListing = {
  id: string;
  title: string;
  description?: string;
  mode: "chat" | "voice" | "video";
  publicTopic?: string;
  community?: string;
  language?: string;
  onlineCount: number;
  capacity: number;
  memberCount: number;
  joinPolicy: "open" | "request" | "invite";
  identityMode?: "names" | "aliases";
};
export type DirectoryFilters = { search: string; mode: string; publicTopic: string; community: string; language: string; mine: boolean };
export const EMPTY_GROUP_FILTERS: DirectoryFilters = { search: "", mode: "", publicTopic: "", community: "", language: "", mine: false };
export const GROUP_TOPICS = [
  ["games", "Game nights"], ["dating", "Dating"], ["relationships", "Relationships"],
  ["banter", "Banter"], ["deep-talks", "Deep talks"],
] as const;
export const GROUP_COMMUNITIES = [["everyone", "Everyone"], ["lgbtq", "LGBTQ+"], ["gay", "Gay"], ["lesbian", "Lesbian"], ["bi-pan", "Bi & pan"], ["queer", "Queer"]] as const;
export const GROUP_LANGUAGES = [["any", "Any language"], ["en", "English"], ["hi", "Hindi"], ["es", "Spanish"], ["fr", "French"], ["de", "German"], ["pt", "Portuguese"]] as const;
const icons = { chat: Icon.chat, voice: Icon.mic, video: Icon.cam };
const modeNames = { chat: "Text chat", voice: "Voice room", video: "Video room" };
const titleFor = (items: ReadonlyArray<readonly [string, string]>, key?: string) => items.find(item => item[0] === key)?.[1];

export function groupLabel(kind: "topic" | "community" | "language", value?: string): string {
  const options = kind === "topic" ? GROUP_TOPICS : kind === "community" ? GROUP_COMMUNITIES : GROUP_LANGUAGES;
  return titleFor(options, value) || value || "";
}

export function GroupDirectory({ groups, filters, onFilters, onOpen, onCreate, loading, error, onRetry, adult = false }: {
  groups: GroupListing[];
  filters: DirectoryFilters;
  onFilters: (value: DirectoryFilters) => void;
  onOpen: (group: GroupListing) => void;
  onCreate: () => void;
  loading: boolean;
  error?: string;
  onRetry: () => void;
  adult?: boolean;
}) {
  const update = (patch: Partial<DirectoryFilters>) => onFilters({ ...filters, ...patch });
  const activeFilters = [filters.publicTopic, filters.community, filters.language].filter(Boolean).length;
  return <main className={styles.directory}>
    <header className={styles.heading}>
      <div><h1>{adult ? "Find your kind of company." : "Find your people."}</h1><p>Join a conversation, make a group, and play together.</p></div>
      <button type="button" className={styles.primary} onClick={onCreate}><Icon.plus size={19} color="currentColor" />Start a group</button>
    </header>
    <nav className={styles.views} aria-label="Group lists">
      <button type="button" aria-pressed={!filters.mine} onClick={() => update({ mine: false })}>Discover</button>
      <button type="button" aria-pressed={filters.mine} onClick={() => update({ mine: true })}>Your groups</button>
    </nav>
    <section className={styles.toolbar} aria-label="Find a group">
      <label className={styles.search}><Icon.discover size={19} color="currentColor" /><span className={styles.srOnly}>Search groups</span><input type="search" placeholder="Find a room" maxLength={80} value={filters.search} onChange={event => update({ search: event.target.value })} /></label>
      <div className={styles.modeFilters} role="group" aria-label="Room type">
        {[["", "All"], ["chat", "Text"], ["voice", "Voice"], ["video", "Video"]].map(([value, label]) => <button key={value} type="button" aria-pressed={filters.mode === value} onClick={() => update({ mode: value })}>{label}</button>)}
      </div>
      <details className={styles.filters}>
        <summary><Icon.settings size={17} color="currentColor" />Filters{activeFilters > 0 && <span>{activeFilters}</span>}</summary>
        <div className={styles.filterFields}>
          <label>Topic<select value={filters.publicTopic} onChange={event => update({ publicTopic: event.target.value })}><option value="">All topics</option>{GROUP_TOPICS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
          {adult && <label>Community<select value={filters.community} onChange={event => update({ community: event.target.value })}><option value="">All communities</option>{GROUP_COMMUNITIES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>}
          <label>Language<select value={filters.language} onChange={event => update({ language: event.target.value })}><option value="">All languages</option>{GROUP_LANGUAGES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        </div>
      </details>
    </section>
    {error ? <div className={styles.empty} role="alert"><h2>Rooms could not load.</h2><p>{error}</p><button type="button" className={styles.secondary} onClick={onRetry}>Try again</button></div>
      : loading && !groups.length ? <div className={styles.empty} role="status">Finding rooms…</div>
      : !groups.length ? <div className={styles.empty}><h2>{filters.mine ? "Make room for your people." : "Start the conversation."}</h2><p>{filters.mine ? "Groups you create or join will appear here." : "There are no groups matching these filters yet."}</p><button type="button" className={styles.secondary} onClick={onCreate}>Start a group</button></div>
      : <div className={styles.grid} aria-busy={loading}>
        {groups.map(group => {
          const RoomIcon = icons[group.mode];
          const details = [titleFor(GROUP_TOPICS, group.publicTopic), adult && group.community !== "everyone" ? titleFor(GROUP_COMMUNITIES, group.community) : "", group.language !== "any" ? titleFor(GROUP_LANGUAGES, group.language) : ""].filter(Boolean);
          return <button className={styles.room} type="button" key={group.id} onClick={() => onOpen(group)}>
            <span className={styles.roomTop}><span><RoomIcon size={19} color="currentColor" />{modeNames[group.mode]}</span><span className={styles.online} data-active={group.onlineCount > 0 || undefined}>{group.onlineCount > 0 ? `${group.onlineCount} online` : "Quiet right now"}</span></span>
            <strong className={styles.roomTitle}>{group.title}</strong>
            {group.description && <span className={styles.description}>{group.description}</span>}
            {details.length > 0 && <span className={styles.tags}>{details.join(" · ")}</span>}
            <span className={styles.roomFoot}><span>{group.identityMode === "aliases" || adult ? "Nicknames" : `${group.memberCount} members`}{group.joinPolicy === "request" ? " · Host approval" : ""}</span><span>View group<Icon.arrowRight size={17} color="currentColor" /></span></span>
          </button>;
        })}
      </div>}
  </main>;
}
