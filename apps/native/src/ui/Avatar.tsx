import {
  Image,
  Text,
  View,
  type ImageStyle,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from "react-native";

import { imageSource, useCachedAvatarUri } from "../services/imageCache";

type AvatarProps = {
  imageStyle: StyleProp<ImageStyle>;
  initials?: string;
  memberId?: string;
  photoURL?: string;
  style: StyleProp<ViewStyle>;
  textStyle: StyleProp<TextStyle>;
  version?: string;
};

export function Avatar({
  imageStyle,
  initials = "?",
  memberId,
  photoURL,
  style,
  textStyle,
  version,
}: AvatarProps) {
  const cachedPhotoURL = useCachedAvatarUri({
    memberId,
    uri: photoURL,
    version,
  });

  return (
    <View style={style}>
      {cachedPhotoURL ? (
        <Image source={imageSource(cachedPhotoURL)} style={imageStyle} />
      ) : (
        <Text style={textStyle}>{initials}</Text>
      )}
    </View>
  );
}
