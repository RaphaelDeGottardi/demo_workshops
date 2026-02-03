"""
TensorFlow Lite Inference Engine
Handles model loading and prediction
"""

import numpy as np
import cv2
"""
TensorFlow Lite Inference Engine
Handles model loading and prediction
"""

import numpy as np
import cv2
import json
import os
import logging
import threading

try:
    import tflite_runtime.interpreter as tflite
except ImportError:
    import tensorflow.lite as tflite


class ModelInference:
    def __init__(self):
        self.interpreter = None
        self.input_details = None
        self.output_details = None
        self.classes = ['Forward', 'Right', 'Left', 'Rotate', 'Idle']  # Default classes
        self.model_loaded = False
        self.input_shape = None
        self.num_classes = None
        self.class_mismatch = False
        self.mismatch_message = None
        self.logger = logging.getLogger('control')
        self.lock = threading.Lock()

    def load_model(self, model_path):
        """Load a TFLite model"""
        try:
            self.logger.info("Loading model from: %s", model_path)

            # Load the TFLite model
            self.interpreter = tflite.Interpreter(model_path=model_path)
            self.interpreter.allocate_tensors()

            # Get input and output details
            self.input_details = self.interpreter.get_input_details()
            self.output_details = self.interpreter.get_output_details()

            # Get input shape
            self.input_shape = self.input_details[0]['shape'][1:3]  # [height, width]

            # Determine number of output classes from model output shape
            out_shape = self.output_details[0]['shape']
            try:
                if len(out_shape) == 1:
                    num = int(out_shape[0])
                else:
                    import numpy as _np
                    num = int(_np.prod(out_shape[1:]))
            except Exception:
                num = None

            self.num_classes = num

            self.logger.info("Model loaded successfully")
            self.logger.info("Input shape: %s", self.input_shape)
            self.logger.info("Input dtype: %s", self.input_details[0]['dtype'])
            self.logger.info("Output shape: %s", self.output_details[0]['shape'])

            # Try to load labels from metadata or use defaults
            self._load_labels(model_path)

            # Validate class count vs model output
            if self.num_classes is not None:
                if len(self.classes) != self.num_classes:
                    self.class_mismatch = True
                    self.mismatch_message = (
                        f"Model output has {self.num_classes} classes but labels file lists {len(self.classes)} classes."
                    )
                    self.logger.warning(self.mismatch_message)
                    # Adjust classes list to match model outputs for safe indexing
                    if len(self.classes) < self.num_classes:
                        for i in range(len(self.classes), self.num_classes):
                            self.classes.append(f"Class_{i}")
                    elif len(self.classes) > self.num_classes:
                        self.classes = self.classes[:self.num_classes]

            self.model_loaded = True

        except Exception as e:
            self.logger.error("Error loading model: %s", e)
            self.model_loaded = False
            raise

    def _load_labels(self, model_path):
        """Try to load class labels from a labels file or metadata"""
        labels_path = model_path.replace('.tflite', '_labels.txt')

        if os.path.exists(labels_path):
            try:
                with open(labels_path, 'r') as f:
                    self.classes = [line.strip() for line in f.readlines()]
                self.logger.info("Loaded %d classes from labels file", len(self.classes))
                return
            except Exception as e:
                self.logger.warning("Could not load labels file: %s", e)

        self.logger.info("Using default classes: %s", self.classes)

    def preprocess_image(self, image):
        """Preprocess image for model input

        Args:
            image: OpenCV image (BGR format) or RGB numpy array
        """
        # Resize to model input size
        img = cv2.resize(image, (self.input_shape[1], self.input_shape[0]))

        # Assume image is already in correct color format (handled by endpoint)
        img_rgb = img

        # Normalize based on dtype
        if self.input_details[0]['dtype'] == np.uint8:
            input_data = img_rgb.astype(np.uint8)
        else:
            input_data = img_rgb.astype(np.float32)
            input_data = input_data / 255.0

        # Add batch dimension
        input_data = np.expand_dims(input_data, axis=0)

        return input_data

    def predict(self, image):
        """
        Run inference on an image

        Args:
            image: OpenCV image (BGR format)

        Returns:
            tuple: (predicted_class_name, confidence)
        """
        if not self.model_loaded:
            raise ValueError("No model loaded")

        try:
            input_data = self.preprocess_image(image)
            with self.lock:
                self.interpreter.set_tensor(self.input_details[0]['index'], input_data)
                self.interpreter.invoke()
                output_data = self.interpreter.get_tensor(self.output_details[0]['index']).copy()

            predictions = output_data[0]
            predicted_index = int(np.argmax(predictions))
            confidence = float(predictions[predicted_index])

            if predicted_index < len(self.classes):
                predicted_class = self.classes[predicted_index]
            else:
                predicted_class = f"Class_{predicted_index}"

            return predicted_class, confidence

        except Exception as e:
            self.logger.error("Error during prediction: %s", e)
            raise

    def get_classes(self):
        """Get list of class names"""
        return self.classes

    def unload_model(self):
        """Unload the current model"""
        self.interpreter = None
        self.input_details = None
        self.output_details = None
        self.model_loaded = False
        self.logger.info("Model unloaded")


# Test function
if __name__ == "__main__":
    import sys
    logger = logging.getLogger('control')

    if len(sys.argv) < 3:
        logger.info("Usage: python inference.py <model_path> <image_path>")
        sys.exit(1)

    model_path = sys.argv[1]
    image_path = sys.argv[2]

    inference = ModelInference()
    inference.load_model(model_path)

    image = cv2.imread(image_path)
    if image is None:
        logger.error("Could not load image: %s", image_path)
        sys.exit(1)

    prediction, confidence = inference.predict(image)
    logger.info("Prediction: %s", prediction)
    logger.info("Confidence: %.2f%%", confidence * 100)
    sys.exit(1)
