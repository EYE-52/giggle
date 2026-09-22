import React, { useMemo, useState } from 'react';
import { LayoutChangeEvent, Text, View, StyleSheet } from 'react-native';
import { arrangeVideoCall, normalizeVideoRatio } from '@giggle/core';
import type { EncounterSide } from '@giggle/core';


export interface AdaptiveStagePerson {
  id: string;
  side: EncounterSide;
  ratio?: number;
}

export function AdaptiveVideoStage({
  mine,
  theirs,
  renderTile,
  mineLabel = 'Yours',
  theirsLabel = 'Theirs',
}: {
  mine: AdaptiveStagePerson[];
  theirs: AdaptiveStagePerson[];
  renderTile: (person: AdaptiveStagePerson) => React.ReactNode;
  mineLabel?: string;
  theirsLabel?: string;
}) {
  const [size, setSize] = useState({ width: 0, height: 0 });
  const onLayout = (event: LayoutChangeEvent) => {
    const { width, height } = event.nativeEvent.layout;
    if (width <= 0 || height <= 0) return;
    setSize((previous) => previous.width === width && previous.height === height ? previous : { width, height });
  };
  const mineKey = mine.map((person) => `${person.id}:${normalizeVideoRatio(person.ratio)}`).join('|');
  const theirsKey = theirs.map((person) => `${person.id}:${normalizeVideoRatio(person.ratio)}`).join('|');
  const layout = useMemo(() => arrangeVideoCall(
    mine.map((person) => normalizeVideoRatio(person.ratio)),
    theirs.map((person) => normalizeVideoRatio(person.ratio)),
    size.width,
    size.height,
  ), [mineKey, theirsKey, size.width, size.height]);
  const renderGroup = (side: EncounterSide, people: AdaptiveStagePerson[]) => {
    if (!people.length) return null;
    const group = side === 'mine' ? layout.mine : layout.theirs;
    const label = side === 'mine' ? mineLabel : theirsLabel;
    return (
      <View key={side} pointerEvents="box-none" style={[styles.group, { width: group.width, height: group.height }]}>
        <Text style={[styles.label, { height: layout.label }]}>{label}</Text>
        {group.tiles.map((tile, index) => {
          const person = people[index];
          if (!person) return null;
          return <View key={person.id} style={[styles.tile, { left: tile.x, top: tile.y + layout.label, width: tile.width, height: tile.height }]}>{renderTile(person)}</View>;
        })}
      </View>
    );
  };
  return <View onLayout={onLayout} style={styles.root}>
    <View style={[styles.groups, { flexDirection: layout.stacked ? 'column' : 'row', justifyContent: layout.stacked ? 'flex-start' : 'center', gap: layout.gap }]}>
      {renderGroup('theirs', theirs)}{renderGroup('mine', mine)}
    </View>
  </View>;
}

const styles = StyleSheet.create({
  root: { flex: 1, minHeight: 0, position: 'relative' },
  groups: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, alignItems: 'center', justifyContent: 'center' },
  group: { position: 'relative', flexShrink: 0, minHeight: 0 },
  label: { height: 26, paddingHorizontal: 2, color: '#c5beb3', fontSize: 12, fontWeight: '400' },
  tile: { position: 'absolute' },
});
