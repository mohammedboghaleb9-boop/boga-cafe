import { Link } from 'react-router';
import { onDisplay } from '@/core/showcase';
import { useCatalog } from '@/data/hooks';
import { fmt, useI18n } from '@/i18n';
import type { MediaName } from '@/shared/media';
import { Icon } from '@/shared/ui/Icon';
import { Photo } from '@/shared/ui/Photo';

/** The three ways into the catalog, on the edge between the dark hero and the cream shelf. */
export function Paths() {
  const { t } = useI18n();
  const { origins } = useCatalog();
  const count = origins.filter(onDisplay).length;
  const paths: { to: string; photo: MediaName; title: string; text: string }[] = [
    { to: '/single-origin', photo: 'greenBeans', title: t.nav.singleOrigin, text: fmt(t.home.pathSingleText, { n: count }) },
    { to: '/custom-blend', photo: 'blendFlatlay', title: t.nav.customBlend, text: t.home.blendTitle },
    { to: '/b2b', photo: 'barista', title: t.nav.b2b, text: t.home.b2bTitle },
  ];
  return (
    <nav className="paths" aria-label={t.home.pathsLabel}>
      <div className="container wide paths-grid">
        {paths.map((p) => (
          <Link key={p.to} to={p.to} className="path">
            <span className="path-media">
              <Photo name={p.photo} alt="" />
            </span>
            <span className="path-body">
              <span>
                <span className="path-title">{p.title}</span>
                <span className="path-text">{p.text}</span>
              </span>
              <span className="path-arrow">
                <Icon name="arrow" size={17} className="flip-rtl" />
              </span>
            </span>
          </Link>
        ))}
      </div>
    </nav>
  );
}
