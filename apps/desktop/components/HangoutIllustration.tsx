import { GiggleAvatar } from "../../../packages/avatars/src";
import styles from "./HangoutIllustration.module.css";

/** Decorative characters, never presented as real members or live activity. */
export function HangoutIllustration({ compact = false }: { compact?: boolean }) {
  return <div className={`${styles.scene} ${compact ? styles.compact : ""}`} aria-hidden="true">
    <div className={styles.orbit} />
    <span className={styles.spark}>✳</span>
    <div className={`${styles.person} ${styles.one}`}><GiggleAvatar hair="curls" skin="#b87955" hairColor="#30251f" accent="#d3dec5" expression="laugh" size="100%" /></div>
    <div className={`${styles.person} ${styles.two}`}><GiggleAvatar hair="bob" skin="#f1bf97" hairColor="#5b342c" accent="#e6ccdf" expression="smile" size="100%" /></div>
    <div className={`${styles.person} ${styles.three}`}><GiggleAvatar hair="swoop" skin="#81513d" hairColor="#29262b" accent="#efc36b" expression="wink" size="100%" /></div>
    <div className={`${styles.person} ${styles.four}`}><GiggleAvatar hair="crop" skin="#e2a87d" hairColor="#b14f32" accent="#bacfdc" expression="smile" size="100%" /></div>
    <svg className={styles.squiggle} viewBox="0 0 170 45" fill="none"><path d="M4 28C27 3 57 43 76 18S112 4 111 22s-15 19-9 3 32-19 62-1" stroke="currentColor" strokeWidth="3" strokeLinecap="round" /></svg>
  </div>;
}
