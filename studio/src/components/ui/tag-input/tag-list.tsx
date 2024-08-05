import React from "react";
import { Tag, TagProps } from "./tag";
import { TagInputStyleClassesProps, type Tag as TagType } from "./tag-input";

export type TagListProps = {
  tags: TagType[];
  customTagRenderer?: (tag: TagType, isActiveTag: boolean) => React.ReactNode;
  direction?: TagProps["direction"];
  className?: string;
  activeTagIndex?: number | null;
  setActiveTagIndex?: (index: number | null) => void;
  classStyleProps: {
    tagClasses: TagInputStyleClassesProps["tag"];
  };
  disabled?: boolean;
} & Omit<TagProps, "tagObj">;

export const TagList: React.FC<TagListProps> = ({
  tags,
  customTagRenderer,
  direction,
  className,
  activeTagIndex,
  setActiveTagIndex,
  classStyleProps,
  disabled,
  ...tagListProps
}) => {
  return tags.map((tagObj, index) =>
    customTagRenderer ? (
      customTagRenderer(tagObj, index === activeTagIndex)
    ) : (
      <Tag
        key={tagObj.id}
        tagObj={tagObj}
        isActiveTag={index === activeTagIndex}
        direction={direction}
        tagClasses={classStyleProps?.tagClasses}
        {...tagListProps}
        disabled={disabled}
      />
    ),
  );
};
