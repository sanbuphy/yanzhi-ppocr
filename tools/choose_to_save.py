import os
import json
from enum import Enum
from datetime import datetime
import shutil

class InputType(Enum):
    TEXT = "text"
    IMAGE = "image"
    PDF = "pdf"

class ContentManager:
    def __init__(self):
        self.config_file = os.path.join(os.path.dirname(__file__), '..', 'data', 'folder_config.json')
        self.ensure_config_exists()

    def ensure_config_exists(self):
        """确保配置文件存在"""
        if not os.path.exists(self.config_file):
            os.makedirs(os.path.dirname(self.config_file), exist_ok=True)
            with open(self.config_file, 'w', encoding='utf-8') as f:
                json.dump({"folders": []}, f, ensure_ascii=False, indent=2)

        # 加载配置
        with open(self.config_file, 'r', encoding='utf-8') as f:
            self.folder_config = json.load(f)

    def save_config(self):
        """保存配置到文件"""
        with open(self.config_file, 'w', encoding='utf-8') as f:
            json.dump(self.folder_config, f, ensure_ascii=False, indent=2)

    def create_folder(self, folder_name, base_path):
        """创建新的子文件夹"""
        try:
            # 创建文件夹路径
            folder_path = os.path.join(base_path, folder_name)

            # 如果文件夹已存在，返回失败
            if os.path.exists(folder_path):
                return False

            # 创建文件夹
            os.makedirs(folder_path, exist_ok=True)

            # 生成描述（这里可以调用AI，但暂时用默认描述）
            description = f"为{folder_name}主题创建的知识文件夹"

            # 添加到配置
            folder_info = {
                "name": folder_name,
                "description": description,
                "path": folder_path,
                "created_at": datetime.now().isoformat()
            }

            self.folder_config["folders"].append(folder_info)
            self.save_config()

            return folder_path

        except Exception as e:
            print(f"创建文件夹失败: {e}")
            return False

    def save_content(self, input_type, file_path=None, description=None, text_content=None):
        """保存内容到合适的文件夹"""
        try:
            # 这里需要实现智能分类逻辑
            # 暂时保存到base_path下的合适文件夹

            # 如果没有描述，使用默认描述
            if not description:
                if input_type == InputType.TEXT:
                    description = "文本内容"
                elif input_type == InputType.IMAGE:
                    description = "图片内容"
                elif input_type == InputType.PDF:
                    description = "PDF文档"

            # 找到最合适的文件夹（暂时用第一个）
            if self.folder_config["folders"]:
                target_folder = self.folder_config["folders"][0]["path"]
            else:
                # 如果没有文件夹，创建一个默认的
                target_folder = self.create_folder("默认分类", os.path.dirname(self.config_file))
                if not target_folder:
                    return False

            # 生成文件名
            timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")

            if input_type == InputType.TEXT:
                filename = f"text_{timestamp}.txt"
                full_path = os.path.join(target_folder, filename)
                with open(full_path, 'w', encoding='utf-8') as f:
                    f.write(text_content or "")

            elif input_type == InputType.IMAGE:
                if file_path and os.path.exists(file_path):
                    ext = os.path.splitext(file_path)[1]
                    filename = f"image_{timestamp}{ext}"
                    full_path = os.path.join(target_folder, filename)
                    shutil.copy2(file_path, full_path)
                else:
                    return False

            elif input_type == InputType.PDF:
                if file_path and os.path.exists(file_path):
                    filename = f"pdf_{timestamp}.pdf"
                    full_path = os.path.join(target_folder, filename)
                    shutil.copy2(file_path, full_path)
                else:
                    return False

            return full_path

        except Exception as e:
            print(f"保存内容失败: {e}")
            return False