import React from 'react';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import CheckDetailScreen from './CheckDetailScreen';
import type { FloorStackParamList } from '../../navigation/types';

type Props = NativeStackScreenProps<FloorStackParamList, 'TableMenu'>;

/** Mobile and tablet share the same authoritative restaurant-check workflow. */
export default function TableMenuScreen(props: Props) {
  return React.createElement(CheckDetailScreen, props as never);
}
