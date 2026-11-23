import { getCollection, type CollectionEntry } from 'astro:content';

export type Chapter = CollectionEntry<'chapters'>;

/** All chapters in reading order. Fails the build if two chapters share an order number. */
export async function getChapters(): Promise<Chapter[]> {
  const chapters = (await getCollection('chapters')).sort((a, b) => a.data.order - b.data.order);
  chapters.forEach((chapter, i) => {
    if (i > 0 && chapter.data.order === chapters[i - 1].data.order) {
      throw new Error(`Chapters "${chapters[i - 1].id}" and "${chapter.id}" both have order ${chapter.data.order}`);
    }
  });
  return chapters;
}
