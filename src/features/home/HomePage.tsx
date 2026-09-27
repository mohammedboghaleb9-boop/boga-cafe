/**
 * Home page = a list of independent sections.
 * Reorder, remove or add a section here; each one lives in ./sections.
 */
import { About } from './sections/About';
import { B2BTeaser } from './sections/B2BTeaser';
import { BlendTeaser } from './sections/BlendTeaser';
import { Featured } from './sections/Featured';
import { Follow } from './sections/Follow';
import { Hero } from './sections/Hero';
import { Origins } from './sections/Origins';
import { Process } from './sections/Process';
import './home.css';

const sections = [Hero, Featured, BlendTeaser, Origins, Process, B2BTeaser, About, Follow];

export function HomePage() {
  return (
    <>
      {sections.map((Section, i) => (
        <Section key={i} />
      ))}
    </>
  );
}
