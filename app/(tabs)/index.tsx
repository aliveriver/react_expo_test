import '@/scripts/pofill';
import * as FileSystem from 'expo-file-system';
import * as ImagePicker from 'expo-image-picker';
import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  LayoutChangeEvent,
  Pressable,
  StyleSheet,
  View,
} from 'react-native';
import { BIN_FILES, MODEL_JSON } from '../../scripts/genBins/out.ts';

import * as tf from '@tensorflow/tfjs';
import { bundleResourceIO, decodeJpeg } from '@tensorflow/tfjs-react-native';

import Svg, { Rect } from 'react-native-svg';

/* -------------------------------------------------------------------------- */
/*                           2  图片 → Tensor 工具                           */
/* -------------------------------------------------------------------------- */

console.log(BIN_FILES, MODEL_JSON, '加载成功');

/* -------------------------------------------------------------------------- */
/*                            1  资源与模型加载                               */
/* -------------------------------------------------------------------------- */

// ❗️React‑Native 必须用静态 require，无法用模板字符串动态拼；
// 下面手动把 25 片 shard 都列出来，供 bundleResourceIO 打包。

// await tf.ready();
// const model = await tf.loadGraphModel(bundleResourceIO(MODEL_JSON, BIN_FILES));

const useYoloModel = () => {
  const [model, setModel] = useState<tf.GraphModel | null>(null);

  useEffect(() => {
    (async () => {
      await tf.ready();
      const m = await tf.loadGraphModel(
        bundleResourceIO(MODEL_JSON, BIN_FILES)
      );
      setModel(m);
    })();
  }, []);

  return model;
};

async function uriToTensor(uri: string) {
  const base64 = await FileSystem.readAsStringAsync(uri, {
    encoding: FileSystem.EncodingType.Base64,
  });
  const raw = tf.util.encodeString(base64, 'base64').buffer;
  const uint8 = new Uint8Array(raw);
  return decodeJpeg(uint8); // Tensor3D [H,W,3]
}

/* -------------------------------------------------------------------------- */
/*                       3  YOLO 推理（前/后处理省略）                        */
/* -------------------------------------------------------------------------- */

type Box = {
  x: number;
  y: number;
  w: number;
  h: number;
  score: number;
  cls: number;
};

async function detect(model: tf.GraphModel, uri: string): Promise<Box[]> {
  const t = await uriToTensor(uri);
  const resized = tf.image.resizeBilinear(t, [640, 640]);
  const input = resized.expandDims(0).div(255.0);
  const out = (await model.executeAsync(input)) as tf.Tensor;
  const boxes = postprocess(out);
  tf.dispose([t, resized, input, out]);
  return boxes;
}

function postprocess(t: tf.Tensor, scoreThr = 0.25, iouThr = 0.45): Box[] {
  const [_, ch, n] = t.shape; // 84, 8400
  const d = t.dataSync();
  const boxes: Box[] = [];
  for (let i = 0; i < n; i++) {
    const off = i * ch;
    const scores = d.subarray(off + 4, off + ch);
    let max = 0,
      cls = 0;
    for (let c = 0; c < scores.length; c++) {
      if (scores[c] > max) {
        max = scores[c];
        cls = c;
      }
    }
    if (max > scoreThr) {
      boxes.push({
        x: d[off + 0],
        y: d[off + 1],
        w: d[off + 2],
        h: d[off + 3],
        score: max,
        cls,
      });
    }
  }
  return boxes; // ⚠️ 省略 NMS & 座标映射，示例用
}

/* -------------------------------------------------------------------------- */
/*                                4  UI 组件                                 */
/* -------------------------------------------------------------------------- */

const DetectionOverlay = ({
  boxes,
  selected,
  onSelect,
  imgW,
  imgH,
}: {
  boxes: Box[];
  selected: number | null;
  onSelect: (i: number) => void;
  imgW: number;
  imgH: number;
}) => {
  return (
    <Svg style={StyleSheet.absoluteFill} pointerEvents='box-none'>
      {boxes.map((b, i) => (
        <Rect
          key={i}
          x={b.x * imgW}
          y={b.y * imgH}
          width={b.w * imgW}
          height={b.h * imgH}
          stroke={i === selected ? '#00e676' : '#ff5252'}
          strokeWidth={2}
          fill='transparent'
          onPress={() => onSelect(i)}
        />
      ))}
    </Svg>
  );
};

/* -------------------------------------------------------------------------- */
/*                      5  主页面：图片选择 + 推理流程                         */
/* -------------------------------------------------------------------------- */

export default function App() {
  const model = useYoloModel();

  const [selectedImage, setSelectedImage] = useState<string | null>(null);
  const [detections, setDetections] = useState<Box[]>([]);
  const [active, setActive] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [viewW, setViewW] = useState(0);
  const [viewH, setViewH] = useState(0);

  /* ----------------------------- 选择图片流程 ----------------------------- */

  const pickImage = async () => {
    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      base64: false,
      quality: 1,
    });
    if (!res.canceled) {
      setSelectedImage(res.assets[0].uri);
      setDetections([]);
      setActive(null);
    }
  };

  const takePhoto = async () => {
    const { status } = await ImagePicker.requestCameraPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permission denied', 'Need camera permission');
      return;
    }
    const res = await ImagePicker.launchCameraAsync({
      base64: false,
      quality: 1,
    });
    if (!res.canceled) {
      setSelectedImage(res.assets[0].uri);
      setDetections([]);
      setActive(null);
    }
  };

  /* ------------------------------ 运行检测 ------------------------------ */

  const runDetection = async () => {
    if (!selectedImage || !model) return;
    setLoading(true);
    try {
      const boxes = await detect(model, selectedImage);
      setDetections(boxes);
      setActive(null);
    } catch (err) {
      console.error(err);
      Alert.alert('Detection error', String(err));
    } finally {
      setLoading(false);
    }
  };

  /* ------------------------------ 渲染 UI ------------------------------ */

  const onImageLayout = ({ nativeEvent }: LayoutChangeEvent) => {
    setViewW(nativeEvent.layout.width);
    setViewH(nativeEvent.layout.height);
  };

  return (
    <View style={styles.container}>
      {selectedImage ? (
        <View style={styles.preview} onLayout={onImageLayout}>
          <Image source={{ uri: selectedImage }} style={styles.image} />
          {!!detections.length && (
            <DetectionOverlay
              boxes={detections}
              selected={active}
              onSelect={setActive}
              imgW={viewW}
              imgH={viewH}
            />
          )}
          {loading && (
            <View style={styles.loading}>
              <ActivityIndicator size='large' />
            </View>
          )}
        </View>
      ) : (
        <View style={styles.placeholder} />
      )}

      <View style={styles.buttons}>
        <Pressable style={styles.btn} onPress={pickImage}>
          <View>
            <Image
              source={require('@/assets/images/icon.png')}
              style={styles.icon}
            />
          </View>
        </Pressable>
        <Pressable style={styles.btn} onPress={takePhoto}>
          <Image
            source={require('@/assets/images/icon.png')}
            style={styles.icon}
          />
        </Pressable>
        <Pressable
          style={[styles.btn, !selectedImage && styles.btnDisabled]}
          onPress={runDetection}
          disabled={!selectedImage || loading || !model}
        >
          <Image
            source={require('@/assets/images/icon.png')}
            style={styles.icon}
          />
        </Pressable>
      </View>
    </View>
  );
}

/* -------------------------------------------------------------------------- */
/*                                  样式                                   */
/* -------------------------------------------------------------------------- */

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 12,
    backgroundColor: '#fff',
  },
  preview: {
    flex: 1,
    borderRadius: 12,
    overflow: 'hidden',
  },
  image: {
    width: '100%',
    height: '100%',
  },
  placeholder: {
    flex: 1,
    borderRadius: 12,
    backgroundColor: '#eee',
  },
  loading: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.25)',
  },
  buttons: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    marginTop: 12,
  },
  btn: {
    backgroundColor: '#6200ee',
    padding: 14,
    borderRadius: 50,
  },
  btnDisabled: {
    opacity: 0.4,
  },
  icon: {
    width: 24,
    height: 24,
    tintColor: '#fff',
  },
});
