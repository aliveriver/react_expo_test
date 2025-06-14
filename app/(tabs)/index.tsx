import '@/scripts/pofill';
import * as tf from '@tensorflow/tfjs';
import { bundleResourceIO, decodeJpeg } from '@tensorflow/tfjs-react-native';
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
  Text,
  View,
} from 'react-native';
// @ts-expect-error – generated at build time
import { BIN_FILES, MODEL_JSON } from '../../scripts/genBins/out.ts';

/** -----------------------------
 *  Types
 * ----------------------------*/
interface DetectionResult {
  boxes: tf.Tensor2D; // [n,4] → x1,y1,x2,y2 (pixel on 640 scale)
  scores: tf.Tensor1D;
  classes: tf.Tensor1D;
}

/** -----------------------------
 *  Constants
 * ----------------------------*/
const INPUT_SIZE = 640;

// 80-class COCO label list (truncated for brevity – include all in real code)
const COCO_LABELS = [
  'Chest Press machine',
  'Lat Pull Down',
  'Seated Cable Rows',
  'arm curl machine',
  'chest fly machine',
  'chinning dipping',
  'lateral raises machine',
  'leg extension',
  'leg press',
  'reg curl machine',
  'seated dip machine',
  'shoulder press machine',
  'smith machine',
];

/** -----------------------------
 *  YOLO decode: [1,84,8400] -> boxes/scores/classes
 *  Output boxes are in pixel coordinates relative to 640 (x1,y1,x2,y2)
 * ----------------------------*/
function decodeYolo(raw: tf.Tensor, scoreThr = 0.25): DetectionResult {
  const [, , n] = raw.shape; // ch = 85, n = 8400
  const pred = raw.squeeze().transpose([1, 0]); // [8400, 84]
  const data = pred.arraySync() as number[][];

  const boxes: number[][] = [];
  const scores: number[] = [];
  const classes: number[] = [];
  const sigmoid = (x: number) => 1 / (1 + Math.exp(-x));

  for (let i = 0; i < n; i++) {
    const [cx, cy, w, h, objLogit, ...clsLogits] = data[i];
    const obj = sigmoid(objLogit);
    let best = 0,
      bestCls = 0;
    clsLogits.forEach((logit, c) => {
      const conf = obj * sigmoid(logit);
      if (conf > best) {
        best = conf;
        bestCls = c;
      }
    });
    if (best > scoreThr) {
      boxes.push([cx - w / 2, cy - h / 2, cx + w / 2, cy + h / 2]);
      scores.push(best);
      classes.push(bestCls);
    }
  }
  return {
    boxes: tf.tensor2d(boxes),
    scores: tf.tensor1d(scores),
    classes: tf.tensor1d(classes, 'int32'),
  };
}

/** -----------------------------
 *  Component
 * ----------------------------*/
export default function Home() {
  const [model, setModel] = useState<tf.GraphModel | null>(null);
  const [loading, setLoading] = useState(false);
  const [uri, setUri] = useState<string | null>(null);
  const [imgLayout, setImgLayout] = useState({ w: 1, h: 1 });
  const [detections, setDetections] = useState<DetectionResult | null>(null);

  /* model loading */
  useEffect(() => {
    let cancelled = false;
    (async () => {
      await tf.setBackend(
        tf.engine().registryFactory['rn-webgl'] ? 'rn-webgl' : 'webgl'
      );
      await tf.ready();
      const m = await tf.loadGraphModel(
        bundleResourceIO(MODEL_JSON, BIN_FILES)
      );
      if (!cancelled) setModel(m);
      m.execute(tf.zeros([1, INPUT_SIZE, INPUT_SIZE, 3]) as tf.Tensor);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  /* image picker */
  const pickImg = async () => {
    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 1,
    });
    if (!res.canceled) {
      setUri(res.assets[0].uri);
      setDetections(null);
    }
  };

  /* NMS helper */
  const applyNMS = async (
    det: DetectionResult,
    maxDet = 20,
    iouThr = 0.5,
    scoreThr = 0.3
  ): Promise<DetectionResult> => {
    const [x1s, y1s, x2s, y2s] = tf.split(det.boxes, 4, 1) as tf.Tensor[];
    const yxyx = tf.concat([y1s, x1s, y2s, x2s], 1) as tf.Tensor2D; // cast to 2D

    const idx = await tf.image.nonMaxSuppressionAsync(
      yxyx, // <-- cast fixed the TS error
      det.scores as tf.Tensor1D,
      maxDet,
      iouThr,
      scoreThr
    );

    const boxesKept = det.boxes.gather(idx) as tf.Tensor2D;
    const scoresKept = det.scores.gather(idx) as tf.Tensor1D;
    const classesKept = det.classes.gather(idx) as tf.Tensor1D;

    yxyx.dispose();
    idx.dispose();
    return { boxes: boxesKept, scores: scoresKept, classes: classesKept };
  };

  /* detection */
  const runDetection = async () => {
    try {
      if (!model) return Alert.alert('模型加载中…');
      if (!uri) return Alert.alert('请先选择图片');
      setLoading(true);

      const base64 = await FileSystem.readAsStringAsync(uri, {
        encoding: FileSystem.EncodingType.Base64,
      });
      const imgTensor = decodeJpeg(
        new Uint8Array(tf.util.encodeString(base64, 'base64').buffer)
      );
      const input = tf.tidy(() =>
        imgTensor
          .resizeBilinear([INPUT_SIZE, INPUT_SIZE])
          .expandDims(0)
          .div(255)
      );

      const raw = model.execute({ images: input }) as tf.Tensor;
      const det = decodeYolo(raw, 0.3);
      const final = await applyNMS(det);
      setDetections(final);

      tf.dispose([imgTensor, input, raw, det.boxes, det.scores, det.classes]);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  /* render boxes */
  const renderDetections = () => {
    if (!detections) return null;
    const boxes = detections.boxes.arraySync() as number[][];
    const scores = detections.scores.dataSync();
    const classes = detections.classes.dataSync();
    const MIN = 0.2;

    return boxes.map(([x1, y1, x2, y2], i) => {
      if (scores[i] < MIN) return null;
      const left = (x1 * imgLayout.w) / INPUT_SIZE;
      const top = (y1 * imgLayout.h) / INPUT_SIZE;
      const width = ((x2 - x1) * imgLayout.w) / INPUT_SIZE;
      const height = ((y2 - y1) * imgLayout.h) / INPUT_SIZE;
      const label = COCO_LABELS[classes[i]] ?? `#${classes[i]}`;

      return (
        <View
          key={i}
          style={{
            position: 'absolute',
            left,
            top,
            width,
            height,
            borderWidth: 2,
            borderColor: 'lime',
          }}
        >
          <Text
            style={{
              position: 'absolute',
              top: -18,
              left: 0,
              backgroundColor: 'rgba(0,0,0,0.6)',
              color: '#fff',
              fontSize: 12,
              paddingHorizontal: 2,
            }}
          >
            {label} {(scores[i] * 100).toFixed(1)}%
          </Text>
        </View>
      );
    });
  };

  return (
    <View style={styles.container}>
      <Text style={styles.h1}>Home</Text>
      <Pressable style={styles.btn} onPress={pickImg}>
        <Text style={styles.btnText}>选择图片</Text>
      </Pressable>
      {uri && (
        <View style={{ width: '90%', aspectRatio: 1 }}>
          <Image
            source={{ uri }}
            style={{ width: '100%', aspectRatio: 1 }}
            onLayout={(e: LayoutChangeEvent) =>
              setImgLayout({
                w: e.nativeEvent.layout.width,
                h: e.nativeEvent.layout.height,
              })
            }
          />
          {renderDetections()}
        </View>
      )}
      {uri && (
        <Pressable
          style={[styles.btn, { marginTop: 32 }]}
          onPress={runDetection}
        >
          {loading ? (
            <ActivityIndicator color='#fff' />
          ) : (
            <Text style={styles.btnText}>Run Detection</Text>
          )}
        </Pressable>
      )}
    </View>
  );
}

/** -----------------------------
 *  Styles
 * ----------------------------*/
const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    paddingTop: 24,
    backgroundColor: '#eee',
  },
  h1: { fontSize: 28, fontWeight: 'bold', marginBottom: 24 },
  btn: {
    backgroundColor: '#4a8dff',
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 8,
  },
  btnText: { color: '#fff', fontSize: 18, fontWeight: '600' },
});
