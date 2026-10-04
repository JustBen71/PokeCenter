import type {LibraryEntry,PokemonArtifactMeta} from '@pokerace/shared';

// Library rows returned by the portal: the former entry shape plus the versioned artifact metadata.
export type LibraryItem=LibraryEntry&{artifact:PokemonArtifactMeta};
